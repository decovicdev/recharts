import React, { Component, cloneElement, isValidElement, createElement } from 'react';
import classNames from 'classnames';
import _ from 'lodash';
import Surface from '../container/Surface';
import Layer from '../container/Layer';
import Tooltip from '../component/Tooltip';
import Legend from '../component/Legend';
import Curve from '../shape/Curve';
import Cross from '../shape/Cross';
import Sector from '../shape/Sector';
import Dot from '../shape/Dot';
import Rectangle from '../shape/Rectangle';

// @ts-ignore
import { findAllByType, findChildByType, getDisplayName, parseChildIndex,
  getPresentationAttributes, validateWidthHeight, isChildrenEqual,
  renderByOrder, getReactEventByType, filterEventAttributes } from '../util/ReactUtils';

import CartesianAxis from '../cartesian/CartesianAxis';
import Brush from '../cartesian/Brush';
import { getOffset, calculateChartCoordinate } from '../util/DOMUtils';
import { getAnyElementOfObject, hasDuplicate, uniqueId, isNumber, findEntryInArray } from '../util/DataUtils';
import { calculateActiveTickIndex, getMainColorOfGraphicItem, getBarSizeList,
  getBarPosition, appendOffsetOfLegend, getLegendProps, combineEventHandlers,
  getTicksOfAxis, getCoordinatesOfGrid, getStackedDataOfItem, parseErrorBarsOfAxis,
  getBandSizeOfAxis, getStackGroupsByAxisId, getValueByDataKey, isCategorialAxis,
  getDomainOfItemsWithSameAxis, getDomainOfStackGroups, getDomainOfDataByKey,
  parseSpecifiedDomain, parseDomainOfCategoryAxis } from '../util/ChartUtils';
import { detectReferenceElementsDomain } from '../util/DetectReferenceElementsDomain';
import { inRangeOfSector, polarToCartesian } from '../util/PolarUtils';
import { shallowEqual } from '../util/ShallowEqual';
import { eventCenter, SYNC_EVENT } from '../util/Events';
import {
  ICommonPropTypes,
  CategoricalChart,
  LayoutType,
} from './index.d';
import {Margin, ViewBox, ChartOffset, BaseAxisProps, Coordinate, ChartCoordinate, TickItem} from '../util/types';

const ORIENT_MAP = {
  xAxis: ['bottom', 'top'],
  yAxis: ['left', 'right'],
};

const originCoordinate: Coordinate = { x: 0, y: 0 };

class State {
  chartX?: number;
  chartY?: number;
  dataStartIndex?: number;
  dataEndIndex?: number;
  activeTooltipIndex?: number;
  isTooltipActive?: boolean;
  updateId?: number;
  xAxisMap?: {
    [k: string]: BaseAxisProps;
  };
  yAxisMap?: {
    [k: string]: BaseAxisProps;
  };
  orderedTooltipTicks?: any;
  tooltipAxis?: BaseAxisProps;
  tooltipTicks?: TickItem[];
  graphicalItems?: any;
  activeCoordinate?: ChartCoordinate;
  offset?: ChartOffset;
  angleAxisMap?: any;
  radiusAxisMap?: any;
  formatedGraphicalItems?: any;
  /** active tooltip payload */
  activePayload?: any[];
  tooltipAxisBandSize?: number;
  /** active item */
  activeItem?: any;
  /** Active label of data */
  activeLabel?: string;
  xValue?: number;
  yValue?: number;
}

const generateCategoricalChart = ({
  chartName,
  GraphicalChild,
  eventType = 'axis',
  axisComponents,
  legendContent,
  formatAxisMap,
  defaultProps,
}: CategoricalChart) => {
  class CategoricalChartWrapper extends Component<ICommonPropTypes, State> {
    static displayName = chartName;

    uniqueChartId: any;
    clipPathId: any;
    legendInstance: any;

    // todo join specific chart propTypes
    static defaultProps: ICommonPropTypes = {
      layout: 'horizontal',
      stackOffset: 'none',
      barCategoryGap: '10%',
      barGap: 4,
      margin: { top: 5, right: 5, bottom: 5, left: 5 } as Margin,
      reverseStackOrder: false,
      ...defaultProps,
    };

    /**
     * Returns default, reset state for the categorical chart.
     * @param {Object} props Props object to use when creating the default state
     * @return {Object} Whole new state
     */
    static createDefaultState = (props: ICommonPropTypes): State => {
      const { children, defaultShowTooltip } = props;
      const brushItem = findChildByType(children, Brush.displayName);
      const startIndex = (brushItem && brushItem.props && brushItem.props.startIndex) || 0;
      const endIndex = (brushItem && brushItem.props && brushItem.props.endIndex) ||
      ((props.data && (props.data.length - 1)) || 0);
      return {
        chartX: 0,
        chartY: 0,
        dataStartIndex: startIndex,
        dataEndIndex: endIndex,
        activeTooltipIndex: -1,
        isTooltipActive: !_.isNil(defaultShowTooltip) ? defaultShowTooltip : false,
      };
    };

    static hasBar = (graphicalItems: any[]): any[] | boolean => {
      if (!graphicalItems || !graphicalItems.length) { return false; }

      return graphicalItems.some((item: any) => {
        const name = getDisplayName(item && item.type);

        return name && name.indexOf('Bar') >= 0;
      });
    };

    static getDisplayedData = (props: ICommonPropTypes, { graphicalItems, dataStartIndex, dataEndIndex }: any, item: any): any[] => {
      const itemsData = (graphicalItems || []).reduce((result: any, child: any) => {
        const itemData = child.props.data;

        if (itemData && itemData.length) {
          return [...result, ...itemData];
        }

        return result;
      }, []);
      if (itemsData && itemsData.length > 0) {
        return itemsData;
      }

      if (item && item.props && item.props.data && item.props.data.length > 0) {
        return item.props.data;
      }

      const { data } = props;

      if (data && data.length && isNumber(dataStartIndex) && isNumber(dataEndIndex)) {
        return data.slice(dataStartIndex, dataEndIndex + 1);
      }

      return [];
    };

    container?: any;

    constructor(props: ICommonPropTypes) {
      super(props);

      const defaultState = (this.constructor as any).createDefaultState(props);
      const updateId = 0;
      this.state = { ...defaultState, updateId: 0,
        ...this.updateStateOfAxisMapsOffsetAndStackGroups({ props, ...defaultState, updateId }) };

      this.uniqueChartId = _.isNil(props.id) ? uniqueId('recharts') : props.id;
      this.clipPathId = `${this.uniqueChartId}-clip`;

      if (props.throttleDelay) {
        this.triggeredAfterMouseMove = _.throttle(this.triggeredAfterMouseMove,
          props.throttleDelay);
      }
    }

    /* eslint-disable  react/no-did-mount-set-state */
    componentDidMount() {
      if (!_.isNil(this.props.syncId)) {
        this.addListener();
      }
    }

    // eslint-disable-next-line camelcase
    UNSAFE_componentWillReceiveProps(nextProps: ICommonPropTypes) {
      const { data, children, width, height, layout, stackOffset, margin } = this.props;
      const { updateId } = this.state;

      if (nextProps.data !== data || nextProps.width !== width ||
        nextProps.height !== height || nextProps.layout !== layout ||
        nextProps.stackOffset !== stackOffset || !shallowEqual(nextProps.margin, margin)) {
        const defaultState = (this.constructor as any).createDefaultState(nextProps);
        this.setState({ ...defaultState, updateId: updateId + 1,
          ...this.updateStateOfAxisMapsOffsetAndStackGroups(
            { props: nextProps, ...defaultState, updateId: updateId + 1 }) }
        );
      } else if (!isChildrenEqual(nextProps.children, children)) {
        // update configuration in chilren
        const hasGlobalData = !_.isNil(nextProps.data);
        const newUpdateId = hasGlobalData ? updateId : updateId + 1;

        this.setState(prevState => ({
          updateId: newUpdateId,
          ...this.updateStateOfAxisMapsOffsetAndStackGroups({
            props: nextProps,
            ...prevState,
            updateId: newUpdateId,
          }),
        }));
      }
      // add syncId
      if (_.isNil(this.props.syncId) && !_.isNil(nextProps.syncId)) {
        this.addListener();
      }
      // remove syncId
      if (!_.isNil(this.props.syncId) && _.isNil(nextProps.syncId)) {
        this.removeListener();
      }
    }

    componentWillUnmount() {
      if (!_.isNil(this.props.syncId)) {
        this.removeListener();
      }
      if (typeof (this.triggeredAfterMouseMove as any).cancel === 'function') {
        (this.triggeredAfterMouseMove as any).cancel();
      }
    }

    /**
   * Get the configuration of all x-axis or y-axis
   * @param  {Object} props          Latest props
   * @param  {String} axisType       The type of axis
   * @param  {Array}  graphicalItems The instances of item
   * @param  {Object} stackGroups    The items grouped by axisId and stackId
   * @param {Number} dataStartIndex  The start index of the data series when a brush is applied
   * @param {Number} dataEndIndex    The end index of the data series when a brush is applied
   * @return {Object}          Configuration
   */
    getAxisMap(props: ICommonPropTypes, { axisType = 'xAxis', AxisComp, graphicalItems, stackGroups, dataStartIndex,
      dataEndIndex }: any) {
      const { children } = props;
      const axisIdKey = `${axisType}Id`;
      // Get all the instance of Axis
      const axes = findAllByType(children, AxisComp);

      let axisMap = {};

      if (axes && axes.length) {
        axisMap = this.getAxisMapByAxes(props, { axes, graphicalItems, axisType, axisIdKey,
          stackGroups, dataStartIndex, dataEndIndex });
      } else if (graphicalItems && graphicalItems.length) {
        axisMap = this.getAxisMapByItems(props, {
          Axis: AxisComp,
          graphicalItems, axisType, axisIdKey, stackGroups, dataStartIndex, dataEndIndex });
      }

      return axisMap;
    }

    /**
     * Get the configuration of axis by the options of axis instance
     * @param  {Object} props         Latest props
     * @param {Array}  axes           The instance of axes
     * @param  {Array} graphicalItems The instances of item
     * @param  {String} axisType      The type of axis, xAxis - x-axis, yAxis - y-axis
     * @param  {String} axisIdKey     The unique id of an axis
     * @param  {Object} stackGroups   The items grouped by axisId and stackId
     * @param {Number} dataStartIndex The start index of the data series when a brush is applied
     * @param {Number} dataEndIndex   The end index of the data series when a brush is applied
     * @return {Object}      Configuration
     */
    getAxisMapByAxes(props: ICommonPropTypes, { axes, graphicalItems, axisType, axisIdKey,
      stackGroups, dataStartIndex, dataEndIndex }: any) {
      const { layout, children, stackOffset } = props;
      const isCategorial = isCategorialAxis(layout, axisType);

      // Eliminate duplicated axes
      const axisMap = axes.reduce((result: any, child: any) => {
        const { type, dataKey, allowDataOverflow, allowDuplicatedCategory,
          scale, ticks } = child.props;
        const axisId = child.props[axisIdKey];
        const displayedData = (this.constructor as any).getDisplayedData(props, {
          graphicalItems: graphicalItems.filter((item: any) => item.props[axisIdKey] === axisId),
          dataStartIndex,
          dataEndIndex,
        });
        const len = displayedData.length;

        if (!result[axisId]) {
          let domain, duplicateDomain, categoricalDomain;

          if (dataKey) {
            domain = getDomainOfDataByKey(displayedData, dataKey, type);

            if (type === 'category' && isCategorial) {
              const duplicate = hasDuplicate(domain);

              if (allowDuplicatedCategory && duplicate) {
                duplicateDomain = domain;
                // When category axis has duplicated text, serial numbers are used to generate scale
                domain = _.range(0, len);
              } else if (!allowDuplicatedCategory) {
                // remove duplicated category
                domain = parseDomainOfCategoryAxis(child.props.domain, domain, child)
                  .reduce((finalDomain: any, entry: any) => (
                    finalDomain.indexOf(entry) >= 0 ? finalDomain : [...finalDomain, entry]
                  ), []);
              }
            } else if (type === 'category') {
              if (!allowDuplicatedCategory) {
                domain = parseDomainOfCategoryAxis(child.props.domain, domain, child)
                  .reduce((finalDomain: any, entry: any) => (
                    (finalDomain.indexOf(entry) >= 0 || entry === '' || _.isNil(entry)) ?
                      finalDomain : [...finalDomain, entry]
                  ), []);
              } else {
                // eliminate undefined or null or empty string
                domain = domain.filter((entry: any) => (entry !== '' && !_.isNil(entry)));
              }
            } else if (type === 'number') {
              const errorBarsDomain = parseErrorBarsOfAxis(
                displayedData,
                graphicalItems.filter((item: any) => (
                  item.props[axisIdKey] === axisId && !item.props.hide
                )),
                dataKey,
                axisType,
              );

              if (errorBarsDomain) {
                domain = errorBarsDomain;
              }
            }

            if (isCategorial && (type === 'number' || scale !== 'auto')) {
              categoricalDomain = getDomainOfDataByKey(displayedData, dataKey, 'category');
            }
          } else if (isCategorial) {
            domain = _.range(0, len);
          } else if (stackGroups && stackGroups[axisId] && stackGroups[axisId].hasStack &&
            type === 'number') {
            // when stackOffset is 'expand', the domain may be calculated as [0, 1.000000000002]
            domain = stackOffset === 'expand' ? [0, 1] : getDomainOfStackGroups(
              stackGroups[axisId].stackGroups, dataStartIndex, dataEndIndex
            );
          } else {
            domain = getDomainOfItemsWithSameAxis(
              displayedData,
              graphicalItems.filter((item: any) => (
                item.props[axisIdKey] === axisId && !item.props.hide
              )),
              type,
              true
            );
          }
          if (type === 'number') {
            // To detect wether there is any reference lines whose props alwaysShow is true
            domain = detectReferenceElementsDomain(children, domain, axisId, axisType, ticks);

            if (child.props.domain) {
              domain = parseSpecifiedDomain(child.props.domain, domain, allowDataOverflow);
            }
          }

          return {
            ...result,
            [axisId]: {
              ...child.props,
              axisType,
              domain,
              categoricalDomain,
              duplicateDomain,
              originalDomain: child.props.domain,
              isCategorial,
              layout,
            },
          };
        }

        return result;
      }, {});
      return axisMap;
    }

    /**
     * Get the configuration of axis by the options of item,
     * this kind of axis does not display in chart
     * @param  {Object} props         Latest props
     * @param  {Array} graphicalItems The instances of item
     * @param  {ReactElement} Axis    Axis Component
     * @param  {String} axisType      The type of axis, xAxis - x-axis, yAxis - y-axis
     * @param  {String} axisIdKey     The unique id of an axis
     * @param  {Object} stackGroups   The items grouped by axisId and stackId
     * @param {Number} dataStartIndex The start index of the data series when a brush is applied
     * @param {Number} dataEndIndex   The end index of the data series when a brush is applied
     * @return {Object}               Configuration
     */
    getAxisMapByItems(props: ICommonPropTypes, { graphicalItems, Axis, axisType, axisIdKey,
      stackGroups, dataStartIndex, dataEndIndex }: any): any {
      const { layout, children } = props;
      const displayedData = (this.constructor as any).getDisplayedData(props, {
        graphicalItems, dataStartIndex, dataEndIndex,
      });
      const len = displayedData.length;
      const isCategorial = isCategorialAxis(layout, axisType);
      let index = -1;

      // The default type of x-axis is category axis,
      // The default contents of x-axis is the serial numbers of data
      // The default type of y-axis is number axis
      // The default contents of y-axis is the domain of data
      const axisMap = graphicalItems.reduce((result: any, child: any) => {
        const axisId = child.props[axisIdKey];

        if (!result[axisId]) {
          index++;
          let domain;

          if (isCategorial) {
            domain = _.range(0, len);
          } else if (stackGroups && stackGroups[axisId] && stackGroups[axisId].hasStack) {
            domain = getDomainOfStackGroups(
              stackGroups[axisId].stackGroups, dataStartIndex, dataEndIndex
            );
            domain = detectReferenceElementsDomain(children, domain, axisId, axisType);
          } else {
            domain = parseSpecifiedDomain(Axis.defaultProps.domain,
              getDomainOfItemsWithSameAxis(
                displayedData,
                graphicalItems.filter((item: any) => (
                  item.props[axisIdKey] === axisId && !item.props.hide
                )),
                'number'
              ),
              Axis.defaultProps.allowDataOverflow
            );
            domain = detectReferenceElementsDomain(children, domain, axisId, axisType);
          }

          return {
            ...result,
            [axisId]: {
              axisType,
              ...Axis.defaultProps,
              hide: true,
              orientation: _.get(ORIENT_MAP, `${axisType}.${index % 2}`, null),
              domain,
              originalDomain: Axis.defaultProps.domain,
              isCategorial,
              layout,
              // specify scale when no Axis
              // scale: isCategorial ? 'band' : 'linear',
            },
          };
        }

        return result;
      }, {});

      return axisMap;
    }

    getActiveCoordinate(tooltipTicks: TickItem[], activeIndex: any, rangeObj: any): ChartCoordinate {
      const { layout } = this.props;
      const entry = tooltipTicks.find((tick: any) => tick && (tick.index === activeIndex));

      if (entry) {
        if (layout === 'horizontal') {
          return { x: entry.coordinate, y: rangeObj.y };
        } if (layout === 'vertical') {
          return { x: rangeObj.x, y: entry.coordinate };
        } if (layout === 'centric') {
          const angle = entry.coordinate;
          const { radius } = rangeObj;

          return {
            ...rangeObj,
            ...polarToCartesian(rangeObj.cx, rangeObj.cy, radius, angle),
            angle, radius,
          };
        }

        const radius = entry.coordinate;
        const { angle } = rangeObj;

        return {
          ...rangeObj,
          ...polarToCartesian(rangeObj.cx, rangeObj.cy, radius, angle),
          angle, radius,
        };
      }

      return originCoordinate;
    }

    /**
     * Get the information of mouse in chart, return null when the mouse is not in the chart
     * @param  {Object} event    The event object
     * @return {Object}          Mouse data
     */
    getMouseInfo(event: any) {
      if (!this.container) { return null; }

      const containerOffset = getOffset(this.container);
      const e = calculateChartCoordinate(event, containerOffset);
      const rangeObj = this.inRange(e.chartX, e.chartY);
      if (!rangeObj) { return null; }

      const { xAxisMap, yAxisMap } = this.state;

      if (eventType !== 'axis' && xAxisMap && yAxisMap) {
        const xScale = getAnyElementOfObject(xAxisMap).scale;
        const yScale = getAnyElementOfObject(yAxisMap).scale;
        const xValue = xScale && xScale.invert ? xScale.invert(e.chartX) : null;
        const yValue = yScale && yScale.invert ? yScale.invert(e.chartY) : null;

        return { ...e, xValue, yValue };
      }

      const { orderedTooltipTicks: ticks, tooltipAxis: axis, tooltipTicks } = this.state;
      const pos = this.calculateTooltipPos(rangeObj);
      const activeIndex = calculateActiveTickIndex(pos, ticks, tooltipTicks, axis);

      if (activeIndex >= 0 && tooltipTicks) {
        const activeLabel = tooltipTicks[activeIndex] && tooltipTicks[activeIndex].value;
        const activePayload = this.getTooltipContent(activeIndex, activeLabel);
        const activeCoordinate = this.getActiveCoordinate(ticks, activeIndex, rangeObj);

        return {
          ...e,
          activeTooltipIndex: activeIndex,
          activeLabel, activePayload, activeCoordinate,
        };
      }

      return null;
    }

    /**
     * Get the content to be displayed in the tooltip
     * @param  {Number} activeIndex    Active index of data
     * @param  {String} activeLabel    Active label of data
     * @return {Array}                 The content of tooltip
     */
    getTooltipContent(activeIndex: number, activeLabel?: string): any[] {
      const { graphicalItems, tooltipAxis } = this.state;
      const displayedData = (this.constructor as any).getDisplayedData(this.props, this.state);

      if (activeIndex < 0 || !graphicalItems || !graphicalItems.length ||
        activeIndex >= displayedData.length) {
        return null;
      }
      // get data by activeIndex when the axis don't allow duplicated category
      return graphicalItems.reduce((result: any, child: any) => {
        const { hide } = child.props;

        if (hide) { return result; }

        const { dataKey, name, unit, formatter, data, tooltipType } = child.props;
        let payload;

        if (tooltipAxis.dataKey && !tooltipAxis.allowDuplicatedCategory) {
          // graphic child has data props
          payload = findEntryInArray(data || displayedData, tooltipAxis.dataKey, activeLabel);
        } else {
          payload = (data && data[activeIndex]) || displayedData[activeIndex];
        }

        if (!payload) { return result; }

        return [...result, {
          ...getPresentationAttributes(child),
          dataKey, unit, formatter,
          name: name || dataKey,
          color: getMainColorOfGraphicItem(child),
          value: getValueByDataKey(payload, dataKey),
          type: tooltipType,
          payload,
        }];
      }, []);
    }

    getFormatItems(props: ICommonPropTypes, currentState: any): any[] {
      const { graphicalItems, stackGroups, offset, updateId, dataStartIndex,
        dataEndIndex } = currentState;
      const { barSize, layout, barGap, barCategoryGap, maxBarSize: globalMaxBarSize } = props;
      const { numericAxisName, cateAxisName } = (this.constructor as any).getAxisNameByLayout(layout);
      const hasBar = (this.constructor as any).hasBar(graphicalItems);
      const sizeList = hasBar && getBarSizeList({ barSize, stackGroups });
      const formatedItems = [] as any[];

      graphicalItems.forEach((item: any, index: number) => {
        const displayedData = (this.constructor as any).getDisplayedData(
          props, { dataStartIndex, dataEndIndex }, item
        );
        const { dataKey, maxBarSize: childMaxBarSize } = item.props;
        const numericAxisId = item.props[`${numericAxisName}Id`];
        const cateAxisId = item.props[`${cateAxisName}Id`];
        const axisObj = axisComponents.reduce((result: any, entry: any) => {
          const axisMap = currentState[`${entry.axisType}Map`];
          const id = item.props[`${entry.axisType}Id`];
          const axis = axisMap && axisMap[id];

          return {
            ...result,
            [entry.axisType]: axis,
            [`${entry.axisType}Ticks`]: getTicksOfAxis(axis),
          };
        }, {});
        const cateAxis = axisObj[cateAxisName];
        const cateTicks = axisObj[`${cateAxisName}Ticks`];
        const stackedData = stackGroups && stackGroups[numericAxisId] &&
            stackGroups[numericAxisId].hasStack &&
            getStackedDataOfItem(item, stackGroups[numericAxisId].stackGroups);
        const bandSize = getBandSizeOfAxis(cateAxis, cateTicks);
        const maxBarSize = _.isNil(childMaxBarSize) ? globalMaxBarSize : childMaxBarSize;
        const barPosition = hasBar && getBarPosition({
          barGap, barCategoryGap, bandSize, sizeList: sizeList[cateAxisId], maxBarSize,
        });
        const componsedFn = item && item.type && item.type.getComposedData;

        if (componsedFn) {
          formatedItems.push({
            props: {
              ...componsedFn({
                ...axisObj, displayedData, props, dataKey, item, bandSize,
                barPosition, offset, stackedData, layout, dataStartIndex, dataEndIndex,
                onItemMouseLeave: combineEventHandlers(
                  this.handleItemMouseLeave, null, item.props.onMouseLeave
                ),
                onItemMouseEnter: combineEventHandlers(
                  this.handleItemMouseEnter, null, item.props.onMouseEnter
                ),
              }),
              key: item.key || `item-${index}`,
              [numericAxisName]: axisObj[numericAxisName],
              [cateAxisName]: axisObj[cateAxisName],
              animationId: updateId,
            },
            childIndex: parseChildIndex(item, props.children),
            item,
          });
        }
      });

      return formatedItems;
    }

    getCursorRectangle(): any {
      const { layout } = this.props;
      const { activeCoordinate, offset, tooltipAxisBandSize } = this.state;
      const halfSize = tooltipAxisBandSize / 2;

      return {
        stroke: 'none',
        fill: '#ccc',
        x: layout === 'horizontal' ? activeCoordinate.x - halfSize : offset.left + 0.5,
        y: layout === 'horizontal' ? offset.top + 0.5 : activeCoordinate.y - halfSize,
        width: layout === 'horizontal' ? tooltipAxisBandSize : offset.width - 1,
        height: layout === 'horizontal' ? offset.height - 1 : tooltipAxisBandSize,
      };
    }

    getCursorPoints(): any {
      const { layout } = this.props;
      const { activeCoordinate, offset } = this.state;
      let x1, y1, x2, y2;

      if (layout === 'horizontal') {
        x1 = activeCoordinate.x;
        x2 = x1;
        y1 = offset.top;
        y2 = offset.top + offset.height;
      } else if (layout === 'vertical') {
        y1 = activeCoordinate.y;
        y2 = y1;
        x1 = offset.left;
        x2 = offset.left + offset.width;
      } else if (!_.isNil(activeCoordinate.cx) || !_.isNil(activeCoordinate.cy)) {
        if (layout === 'centric') {
          const { cx, cy, innerRadius, outerRadius, angle } = activeCoordinate;
          const innerPoint = polarToCartesian(cx, cy, innerRadius, angle);
          const outerPoint = polarToCartesian(cx, cy, outerRadius, angle);
          x1 = innerPoint.x;
          y1 = innerPoint.y;
          x2 = outerPoint.x;
          y2 = outerPoint.y;
        } else {
          const { cx, cy, radius, startAngle, endAngle } = activeCoordinate;
          const startPoint = polarToCartesian(cx, cy, radius, startAngle);
          const endPoint = polarToCartesian(cx, cy, radius, endAngle);

          return {
            points: [startPoint, endPoint],
            cx, cy, radius, startAngle, endAngle,
          };
        }
      }

      return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    }

    static getAxisNameByLayout(layout: LayoutType) {
      if (layout === 'horizontal') {
        return { numericAxisName: 'yAxis', cateAxisName: 'xAxis' };
      } if (layout === 'vertical') {
        return { numericAxisName: 'xAxis', cateAxisName: 'yAxis' };
      } if (layout === 'centric') {
        return { numericAxisName: 'radiusAxis', cateAxisName: 'angleAxis' };
      }

      return { numericAxisName: 'angleAxis', cateAxisName: 'radiusAxis' };
    }

    calculateTooltipPos(rangeObj: any): any {
      const { layout } = this.props;

      if (layout === 'horizontal') { return rangeObj.x; }
      if (layout === 'vertical') { return rangeObj.y; }
      if (layout === 'centric') { return rangeObj.angle; }

      return rangeObj.radius;
    }

    inRange(x: number, y: number): any {
      const { layout } = this.props;

      if (layout === 'horizontal' || layout === 'vertical') {
        const { offset } = this.state;
        const isInRange = x >= offset.left && x <= (offset.left + offset.width) &&
          y >= offset.top && y <= offset.top + offset.height;

        return isInRange ? { x, y } : null;
      }

      const { angleAxisMap, radiusAxisMap } = this.state;

      if (angleAxisMap && radiusAxisMap) {
        const angleAxis = getAnyElementOfObject(angleAxisMap);

        return inRangeOfSector({ x, y }, angleAxis);
      }

      return null;
    }

    parseEventsOfWrapper() {
      const { children } = this.props;
      const tooltipItem = findChildByType(children, Tooltip.displayName);
      const tooltipEvents = tooltipItem && eventType === 'axis' ? {
        onMouseEnter: this.handleMouseEnter,
        onMouseMove: this.handleMouseMove,
        onMouseLeave: this.handleMouseLeave,
        onTouchMove: this.handleTouchMove,
        onTouchStart: this.handleTouchStart,
        onTouchEnd: this.handleTouchEnd,
      } : {};
      const outerEvents = filterEventAttributes(this.props, this.handleOuterEvent);

      return {
        ...outerEvents,
        ...tooltipEvents,
      };
    }

    /**
     * The AxisMaps are expensive to render on large data sets
     * so provide the ability to store them in state and only update them when necessary
     * they are dependent upon the start and end index of
     * the brush so it's important that this method is called _after_
     * the state is updated with any new start/end indices
     *
     * @param {Object} props          The props object to be used for updating the axismaps
     * @param {Number} dataStartIndex The start index of the data series when a brush is applied
     * @param {Number} dataEndIndex   The end index of the data series when a brush is applied
     * @param {Number} updateId       The update id
     * @return {Object} state New state to set
     */
    updateStateOfAxisMapsOffsetAndStackGroups({ props, dataStartIndex, dataEndIndex, updateId }: any): any {
      if (!validateWidthHeight({ props })) { return null; }

      const { children, layout, stackOffset, data, reverseStackOrder } = props;
      const { numericAxisName, cateAxisName } = (this.constructor as any).getAxisNameByLayout(layout);
      const graphicalItems = findAllByType(children, GraphicalChild);
      const stackGroups = getStackGroupsByAxisId(
        data, graphicalItems, `${numericAxisName}Id`, `${cateAxisName}Id`, stackOffset, reverseStackOrder
      );
      const axisObj = axisComponents.reduce((result: any, entry: any) => {
        const name = `${entry.axisType}Map`;

        return {
          ...result,
          [name]: this.getAxisMap(props, {
            ...entry,
            graphicalItems,
            stackGroups: entry.axisType === numericAxisName && stackGroups,
            dataStartIndex,
            dataEndIndex,
          }),
        };
      }, {});

      const offset = this.calculateOffset({ ...axisObj, props, graphicalItems });

      Object.keys(axisObj).forEach((key) => {
        axisObj[key] = formatAxisMap(
          props, axisObj[key], offset, key.replace('Map', ''), chartName
        );
      });
      const cateAxisMap = axisObj[`${cateAxisName}Map`];
      const ticksObj = this.tooltipTicksGenerator(cateAxisMap);

      const formatedGraphicalItems = this.getFormatItems(props, {
        ...axisObj, dataStartIndex, dataEndIndex, updateId,
        graphicalItems, stackGroups, offset,
      });

      return {
        formatedGraphicalItems, graphicalItems, offset, stackGroups,
        ...ticksObj, ...axisObj,
      };
    }

    /* eslint-disable  no-underscore-dangle */
    addListener() {
      eventCenter.on(SYNC_EVENT, this.handleReceiveSyncEvent);

      if (eventCenter.setMaxListeners && eventCenter._maxListeners) {
        eventCenter.setMaxListeners(eventCenter._maxListeners + 1);
      }
    }

    removeListener() {
      eventCenter.removeListener(SYNC_EVENT, this.handleReceiveSyncEvent);

      if (eventCenter.setMaxListeners && eventCenter._maxListeners) {
        eventCenter.setMaxListeners(eventCenter._maxListeners - 1);
      }
    }

    /**
     * Calculate the offset of main part in the svg element
     * @param  {Object} props          Latest props
     * @param  {Array}  graphicalItems The instances of item
     * @param  {Object} xAxisMap       The configuration of x-axis
     * @param  {Object} yAxisMap       The configuration of y-axis
     * @return {Object} The offset of main part in the svg element
     */
    calculateOffset({ props, graphicalItems, xAxisMap = {} as BaseAxisProps, yAxisMap = {} as BaseAxisProps }: any) {
      const { width, height, children } = props;
      const margin = props.margin || {};
      const brushItem = findChildByType(children, Brush.displayName);
      const legendItem = findChildByType(children, Legend.displayName);

      const offsetH = Object.keys(yAxisMap).reduce((result: any, id: any) => {
        const entry = yAxisMap[id];
        const { orientation } = entry;

        if (!entry.mirror && !entry.hide) {
          return { ...result, [orientation]: result[orientation] + entry.width };
        }

        return result;
      }, { left: margin.left || 0, right: margin.right || 0 });

      const offsetV = Object.keys(xAxisMap).reduce((result, id) => {
        const entry = xAxisMap[id];
        const { orientation } = entry;

        if (!entry.mirror && !entry.hide) {
          return { ...result, [orientation]: _.get(result, `${orientation}`) + entry.height };
        }

        return result;
      }, { top: margin.top || 0, bottom: margin.bottom || 0 });

      let offset = { ...offsetV, ...offsetH };

      const brushBottom = offset.bottom;

      if (brushItem) {
        offset.bottom += brushItem.props.height || Brush.defaultProps.height;
      }

      if (legendItem && this.legendInstance) {
        const legendBox = this.legendInstance.getBBox();

        offset = appendOffsetOfLegend(offset, graphicalItems, props, legendBox);
      }

      return {
        brushBottom,
        ...offset,
        width: width - offset.left - offset.right,
        height: height - offset.top - offset.bottom,
      };
    }

    handleLegendBBoxUpdate = (box: any) => {
      if (box && this.legendInstance) {
        const { dataStartIndex, dataEndIndex, updateId } = this.state;

        this.setState(
          this.updateStateOfAxisMapsOffsetAndStackGroups({
            props: this.props, dataStartIndex, dataEndIndex, updateId,
          })
        );
      }
    };

    handleReceiveSyncEvent = (cId: any, chartId: any, data: any) => {
      const { syncId, layout } = this.props;
      const { updateId } = this.state;

      if (syncId === cId && chartId !== this.uniqueChartId) {
        const { dataStartIndex, dataEndIndex } = data;

        if (!_.isNil(data.dataStartIndex) || !_.isNil(data.dataEndIndex)) {
          this.setState({
            dataStartIndex,
            dataEndIndex,
            ...this.updateStateOfAxisMapsOffsetAndStackGroups(
              { props: this.props, dataStartIndex, dataEndIndex, updateId }
            ),
          });
        } else if (!_.isNil(data.activeTooltipIndex)) {
          const { chartX, chartY, activeTooltipIndex } = data;
          const { offset, tooltipTicks } = this.state;
          if (!offset) { return; }
          const viewBox: ViewBox = { ...offset, x: offset.left, y: offset.top };
          // When a categotical chart is combined with another chart, the value of chartX
          // and chartY may beyond the boundaries.
          const validateChartX = Math.min(chartX, viewBox.x + viewBox.width);
          const validateChartY = Math.min(chartY, viewBox.y + viewBox.height);
          const activeLabel = tooltipTicks[activeTooltipIndex] &&
            tooltipTicks[activeTooltipIndex].value;
          const activePayload: any = this.getTooltipContent(activeTooltipIndex);
          const activeCoordinate = tooltipTicks[activeTooltipIndex] ? {
            x: layout === 'horizontal' ? tooltipTicks[activeTooltipIndex].coordinate : validateChartX,
            y: layout === 'horizontal' ? validateChartY : tooltipTicks[activeTooltipIndex].coordinate,
          } : originCoordinate;

          this.setState({ ...data, activeLabel, activeCoordinate, activePayload });
        } else {
          this.setState(data);
        }
      }
    };

    handleBrushChange = ({ startIndex, endIndex }: any) => {
      // Only trigger changes if the extents of the brush have actually changed
      if (startIndex !== this.state.dataStartIndex || endIndex !== this.state.dataEndIndex) {
        const { updateId } = this.state;

        this.setState(() => ({
          dataStartIndex: startIndex,
          dataEndIndex: endIndex,
          ...this.updateStateOfAxisMapsOffsetAndStackGroups(
            { props: this.props, dataStartIndex: startIndex, dataEndIndex: endIndex, updateId }
          ),
        }));

        this.triggerSyncEvent({
          dataStartIndex: startIndex,
          dataEndIndex: endIndex,
        });
      }
    };

    /**
     * The handler of mouse entering chart
     * @param  {Object} e              Event object
     * @return {Null}                  null
     */
    handleMouseEnter = (e: any) => {
      const { onMouseEnter } = this.props;
      const mouse = this.getMouseInfo(e);

      if (mouse) {
        const nextState: State = { ...mouse, isTooltipActive: true };
        this.setState(nextState);
        this.triggerSyncEvent(nextState);

        if (_.isFunction(onMouseEnter)) {
          onMouseEnter(nextState, e);
        }
      }
    };

    triggeredAfterMouseMove = (e: any): any => {
      const { onMouseMove } = this.props;
      const mouse = this.getMouseInfo(e);
      const nextState: State = mouse ? { ...mouse, isTooltipActive: true } : { isTooltipActive: false };

      this.setState(nextState);
      this.triggerSyncEvent(nextState);

      if (_.isFunction(onMouseMove)) {
        onMouseMove(nextState, e);
      }
    }

    /**
     * The handler of mouse entering a scatter
     * @param {Object} el     The active scatter
     * @return {Object} no return
     */
    handleItemMouseEnter = (el: any) => {
      this.setState(() => ({
        isTooltipActive: true,
        activeItem: el,
        activePayload: el.tooltipPayload,
        activeCoordinate: el.tooltipPosition || { x: el.cx, y: el.cy },
      }));
    };

    /**
     * The handler of mouse leaving a scatter
     * @return {Object} no return
     */
    handleItemMouseLeave = () => {
      this.setState(() => ({
        isTooltipActive: false,
      }));
    };

    /**
     * The handler of mouse moving in chart
     * @param  {Object} e        Event object
     * @return {Null} no return
     */
    handleMouseMove = (e: any) => {
      if (e && _.isFunction(e.persist)) {
        e.persist();
      }
      this.triggeredAfterMouseMove(e);
    }

    /**
     * The handler if mouse leaving chart
     * @param {Object} e Event object
     * @return {Null} no return
     */
    handleMouseLeave = (e: any) => {
      const { onMouseLeave } = this.props;
      const nextState = { isTooltipActive: false };

      this.setState(nextState);
      this.triggerSyncEvent(nextState);

      if (_.isFunction(onMouseLeave)) {
        onMouseLeave(nextState, e);
      }
    };

    handleOuterEvent = (e: any) => {
      const eventName = getReactEventByType(e);

      const event = _.get(this.props, `${eventName}`);
      if (eventName && _.isFunction(event)) {
        const mouse = this.getMouseInfo(e);
        const handler = event;

        handler(mouse, e);
      }
    };

    handleClick = (e: any) => {
      const { onClick } = this.props;

      if (_.isFunction(onClick)) {
        const mouse = this.getMouseInfo(e);

        onClick(mouse, e);
      }
    };

    handleMouseDown = (e: any) => {
      const { onMouseDown } = this.props;

      if (_.isFunction(onMouseDown)) {
        const mouse = this.getMouseInfo(e);

        onMouseDown(mouse, e);
      }
    };

    handleMouseUp = (e: any) => {
      const { onMouseUp } = this.props;

      if (_.isFunction(onMouseUp)) {
        const mouse = this.getMouseInfo(e);

        onMouseUp(mouse, e);
      }
    };

    handleTouchMove = (e: any) => {
      if (e.changedTouches != null && e.changedTouches.length > 0) {
        this.handleMouseMove(e.changedTouches[0]);
      }
    };

    handleTouchStart = (e: any) => {
      if (e.changedTouches != null && e.changedTouches.length > 0) {
        this.handleMouseDown(e.changedTouches[0]);
      }
    };

    handleTouchEnd = (e: any) => {
      if (e.changedTouches != null && e.changedTouches.length > 0) {
        this.handleMouseUp(e.changedTouches[0]);
      }
    };

    triggerSyncEvent(data: any) {
      const { syncId } = this.props;

      if (!_.isNil(syncId)) {
        eventCenter.emit(SYNC_EVENT, syncId, this.uniqueChartId, data);
      }
    }

    verticalCoordinatesGenerator = ({
      xAxis, width, height, offset,
    }: ChartCoordinate) => getCoordinatesOfGrid(CartesianAxis.getTicks({
      ...CartesianAxis.defaultProps,
      ...xAxis,
      ticks: getTicksOfAxis(xAxis, true),
      viewBox: { x: 0, y: 0, width, height },
    }), offset.left, offset.left + offset.width);

    horizontalCoordinatesGenerator = ({
      yAxis, width, height, offset,
    }: ChartCoordinate) => getCoordinatesOfGrid(CartesianAxis.getTicks({
      ...CartesianAxis.defaultProps, ...yAxis,
      ticks: getTicksOfAxis(yAxis, true),
      viewBox: { x: 0, y: 0, width, height },
    }), offset.top, offset.top + offset.height);

    axesTicksGenerator = (axis: any) => getTicksOfAxis(axis, true);

    tooltipTicksGenerator = (axisMap: any) => {
      const axis = getAnyElementOfObject(axisMap);
      const tooltipTicks = getTicksOfAxis(axis, false, true);

      return {
        tooltipTicks,
        orderedTooltipTicks: _.sortBy(tooltipTicks, o => o.coordinate),
        tooltipAxis: axis,
        tooltipAxisBandSize: getBandSizeOfAxis(axis),
      };
    }

    filterFormatItem(item: any, displayName: any, childIndex: any) {
      const { formatedGraphicalItems } = this.state;

      for (let i = 0, len = formatedGraphicalItems.length; i < len; i++) {
        const entry = formatedGraphicalItems[i];

        if (entry.item === item || entry.props.key === item.key || (
          displayName === getDisplayName(entry.item.type) && childIndex === entry.childIndex
        )) {
          return entry;
        }
      }

      return null;
    }

    renderCursor = (element: any) => {
      const { isTooltipActive, activeCoordinate, activePayload, offset } = this.state;

      if (!element || !element.props.cursor || !isTooltipActive || !activeCoordinate) {
        return null;
      }
      const { layout } = this.props;
      let restProps;
      let cursorComp: any = Curve;

      if (chartName === 'ScatterChart') {
        restProps = activeCoordinate;
        cursorComp = Cross;
      } else if (chartName === 'BarChart') {
        restProps = this.getCursorRectangle();
        cursorComp = Rectangle;
      } else if (layout === 'radial') {
        const { cx, cy, radius, startAngle, endAngle }: any = this.getCursorPoints();
        restProps = {
          cx, cy, startAngle, endAngle, innerRadius: radius, outerRadius: radius,
        };
        cursorComp = Sector;
      } else {
        restProps = { points: this.getCursorPoints() };
        cursorComp = Curve;
      }
      const key = element.key || '_recharts-cursor';
      const cursorProps = {
        stroke: '#ccc',
        pointerEvents: 'none',
        ...offset,
        ...restProps,
        ...getPresentationAttributes(element.props.cursor),
        payload: activePayload,
        key,
        className: 'recharts-tooltip-cursor',
      };

      return isValidElement(element.props.cursor) ?
        cloneElement(element.props.cursor, cursorProps) :
        createElement(cursorComp, cursorProps);
    };

    renderPolarAxis = (element: any, displayName: string, index: number) => {
      const axisType = _.get(element, 'type.axisType');
      const axisMap = _.get(this.state, `${axisType}Map`);
      const axisOption = axisMap[element.props[`${axisType}Id`]];

      return cloneElement(element, {
        ...axisOption,
        className: axisType,
        key: element.key || `${displayName}-${index}`,
        ticks: getTicksOfAxis(axisOption, true),
      });
    };

    renderXAxis = (element: any, displayName: string, index: number) => {
      const { xAxisMap } = this.state;
      const axisObj = xAxisMap[element.props.xAxisId];

      return this.renderAxis(axisObj, element, displayName, index);
    };

    renderYAxis = (element: any, displayName: string, index: number) => {
      const { yAxisMap } = this.state;
      const axisObj = yAxisMap[element.props.yAxisId];

      return this.renderAxis(axisObj, element, displayName, index);
    };

    /**
     * Draw axis
     * @param {Object} axisOptions The options of axis
     * @param {Object} element      The axis element
     * @param {String} displayName  The display name of axis
     * @param {Number} index        The index of element
     * @return {ReactElement}       The instance of x-axes
     */
    renderAxis(axisOptions: BaseAxisProps, element: any, displayName: string, index: number): React.ReactElement {
      const { width, height } = this.props;

      return (
        <CartesianAxis
          {...axisOptions}
          className={`recharts-${axisOptions.axisType} ${axisOptions.axisType}`}
          key={element.key || `${displayName}-${index}`}
          // @ts-ignore
          viewBox={{ x: 0, y: 0, width, height }}
          ticksGenerator={this.axesTicksGenerator}
        />
      );
    }

    /**
     * Draw grid
     * @param  {ReactElement} element the grid item
     * @return {ReactElement} The instance of grid
     */
    renderGrid = (element: React.ReactElement): React.ReactElement => {
      const { xAxisMap, yAxisMap, offset } = this.state;
      const { width, height } = this.props;
      const xAxis = getAnyElementOfObject(xAxisMap);
      const yAxisWithFiniteDomain = _.find(yAxisMap, axis => _.every(axis.domain, Number.isFinite));
      const yAxis = yAxisWithFiniteDomain || getAnyElementOfObject(yAxisMap);
      const props = element.props || {};

      return cloneElement(element, {
        key: element.key || 'grid',
        x: isNumber(props.x) ? props.x : offset.left,
        y: isNumber(props.y) ? props.y : offset.top,
        width: isNumber(props.width) ? props.width : offset.width,
        height: isNumber(props.height) ? props.height : offset.height,
        xAxis,
        yAxis,
        offset,
        chartWidth: width,
        chartHeight: height,
        verticalCoordinatesGenerator:
          props.verticalCoordinatesGenerator || this.verticalCoordinatesGenerator,
        horizontalCoordinatesGenerator:
          props.horizontalCoordinatesGenerator || this.horizontalCoordinatesGenerator,
      });
    };

    renderPolarGrid = (element: React.ReactElement): React.ReactElement  => {
      const { radiusAxisMap, angleAxisMap } = this.state;
      const radiusAxis = getAnyElementOfObject(radiusAxisMap);
      const angleAxis = getAnyElementOfObject(angleAxisMap);
      const { cx, cy, innerRadius, outerRadius } = angleAxis;

      return cloneElement(element, {
        polarAngles: getTicksOfAxis(angleAxis, true).map((entry: any) => entry.coordinate),
        polarRadius: getTicksOfAxis(radiusAxis, true).map((entry: any) => entry.coordinate),
        cx, cy, innerRadius, outerRadius,
        key: element.key || 'polar-grid',
      });
    };

    /**
     * Draw legend
     * @return {ReactElement}            The instance of Legend
     */
    renderLegend = (): React.ReactElement => {
      const { formatedGraphicalItems } = this.state;
      const { children, width, height } = this.props;
      const margin = this.props.margin || {};
      const legendWidth: number = width - (margin.left || 0) - (margin.right || 0);
      const legendHeight: number = height - (margin.top || 0) - (margin.bottom || 0);
      const props = getLegendProps({
        children, formatedGraphicalItems, legendWidth, legendContent,
      });

      if (!props) { return null; }

      const { item, ...otherProps } = props;

      return cloneElement(item, {
        ...otherProps,
        chartWidth: width,
        chartHeight: height,
        margin,
        ref: (legend: any) => { this.legendInstance = legend; },
        onBBoxUpdate: this.handleLegendBBoxUpdate,
      });
    }

    /**
     * Draw Tooltip
     * @return {ReactElement}  The instance of Tooltip
     */
    renderTooltip = (): React.ReactElement => {
      const { children } = this.props;
      const tooltipItem = findChildByType(children, Tooltip.displayName);

      if (!tooltipItem) { return null; }

      const { isTooltipActive, activeCoordinate, activePayload,
        activeLabel, offset } = this.state;

      return cloneElement(tooltipItem, {
        viewBox: { ...offset, x: offset.left, y: offset.top },
        active: isTooltipActive,
        label: activeLabel,
        payload: isTooltipActive ? activePayload : [],
        coordinate: activeCoordinate,
      });
    }

    renderBrush = (element: React.ReactElement) => {
      const { margin, data } = this.props;
      const { offset, dataStartIndex, dataEndIndex, updateId } = this.state;

      // TODO: update brush when children update
      return cloneElement(element, {
        key: element.key || '_recharts-brush',
        onChange: combineEventHandlers(this.handleBrushChange, null, element.props.onChange),
        data,
        x: isNumber(element.props.x) ? element.props.x : offset.left,
        y: isNumber(element.props.y) ? element.props.y :
          (offset.top + offset.height + offset.brushBottom - (margin.bottom || 0)),
        width: isNumber(element.props.width) ? element.props.width : offset.width,
        startIndex: dataStartIndex,
        endIndex: dataEndIndex,
        updateId: `brush-${updateId}`,
      });
    };

    renderReferenceElement = (element: React.ReactElement , displayName: string, index: number): React.ReactElement  => {
      if (!element) { return null; }
      const { clipPathId } = this;
      const { xAxisMap, yAxisMap, offset } = this.state;
      const { xAxisId, yAxisId } = element.props;

      return cloneElement(element, {
        key: element.key || `${displayName}-${index}`,
        xAxis: xAxisMap[xAxisId],
        yAxis: yAxisMap[yAxisId],
        viewBox: {
          x: offset.left,
          y: offset.top,
          width: offset.width,
          height: offset.height,
        },
        clipPathId,
      });
    };

    static renderActiveDot(option: any, props: any): React.ReactElement {
      let dot;

      if (isValidElement(option)) {
        dot = cloneElement(option, props);
      } else if (_.isFunction(option)) {
        dot = option(props);
      } else {
        dot = <Dot {...props} />;
      }

      return (
        <Layer className="recharts-active-dot" key={props.key}>
          {dot}
        </Layer>
      );
    }

    renderActivePoints({ item, activePoint, basePoint, childIndex, isRange }: any): any[] {
      const result = [];
      const { key } = item.props;
      const { activeDot, dataKey } = item.item.props;
      const dotProps = {
        index: childIndex,
        dataKey,
        cx: activePoint.x,
        cy: activePoint.y,
        r: 4,
        fill: getMainColorOfGraphicItem(item.item),
        strokeWidth: 2,
        stroke: '#fff',
        payload: activePoint.payload,
        value: activePoint.value,
        key: `${key}-activePoint-${childIndex}`,
        ...getPresentationAttributes(activeDot),
        ...filterEventAttributes(activeDot),
      };

      result.push((this.constructor as any).renderActiveDot(activeDot, dotProps, childIndex));

      if (basePoint) {
        result.push((this.constructor as any).renderActiveDot(activeDot, {
          ...dotProps,
          cx: basePoint.x,
          cy: basePoint.y,
          key: `${key}-basePoint-${childIndex}`,
        }, childIndex));
      } else if (isRange) {
        result.push(null);
      }

      return result;
    }

    renderGraphicChild = (element: React.ReactElement , displayName: string, index: number): any[] => {
      const item = this.filterFormatItem(element, displayName, index);
      if (!item) { return null; }

      const graphicalItem = cloneElement(element, item.props);
      const { isTooltipActive, tooltipAxis, activeTooltipIndex, activeLabel } = this.state;
      const { children } = this.props;
      const tooltipItem = findChildByType(children, Tooltip.displayName);
      const { points, isRange, baseLine } = item.props;
      const { activeDot, hide } = item.item.props;
      const hasActive = !hide && isTooltipActive && tooltipItem && activeDot &&
        activeTooltipIndex >= 0;

      function findWithPayload(entry: any) {
        return tooltipAxis.dataKey(entry.payload);
      }

      if (hasActive) {
        let activePoint, basePoint;

        if (tooltipAxis.dataKey && !tooltipAxis.allowDuplicatedCategory) {
          const specifiedKey = typeof tooltipAxis.dataKey === 'function' ? findWithPayload : 'payload.'.concat(tooltipAxis.dataKey);
          activePoint = findEntryInArray(points, specifiedKey, activeLabel);
          basePoint = isRange && baseLine && findEntryInArray(baseLine, specifiedKey, activeLabel);
        } else {
          activePoint = points[activeTooltipIndex];
          basePoint = isRange && baseLine && baseLine[activeTooltipIndex];
        }

        if (!_.isNil(activePoint)) {
          return [
            graphicalItem,
            ...this.renderActivePoints({
              item, activePoint, basePoint, childIndex: activeTooltipIndex,
              isRange,
            }),
          ];
        }
      }

      if (isRange) { return [graphicalItem, null, null]; }

      return [graphicalItem, null];
    };

    renderCustomized = (element: React.ReactElement ): React.ReactElement  => cloneElement(element, {
      ...this.props,
      ...this.state
    })

    renderClipPath() {
      const { clipPathId } = this;
      const { offset: { left, top, height, width } } = this.state;

      return (
        <defs>
          <clipPath id={clipPathId}>
            <rect x={left} y={top} height={height} width={width} />
          </clipPath>
        </defs>
      );
    }


    render() {
      if (!validateWidthHeight(this)) { return null; }

      const { children, className, width, height, style, compact, ...others } = this.props;
      const attrs = getPresentationAttributes(others);
      const map = {
        CartesianGrid: { handler: this.renderGrid, once: true },
        ReferenceArea: { handler: this.renderReferenceElement },
        ReferenceLine: { handler: this.renderReferenceElement },
        ReferenceDot: { handler: this.renderReferenceElement },
        XAxis: { handler: this.renderXAxis },
        YAxis: { handler: this.renderYAxis },
        Brush: { handler: this.renderBrush, once: true },
        Bar: { handler: this.renderGraphicChild },
        Line: { handler: this.renderGraphicChild },
        Area: { handler: this.renderGraphicChild },
        Radar: { handler: this.renderGraphicChild },
        RadialBar: { handler: this.renderGraphicChild },
        Scatter: { handler: this.renderGraphicChild },
        Pie: { handler: this.renderGraphicChild },
        Funnel: { handler: this.renderGraphicChild },
        Tooltip: { handler: this.renderCursor, once: true },
        PolarGrid: { handler: this.renderPolarGrid, once: true },
        PolarAngleAxis: { handler: this.renderPolarAxis },
        PolarRadiusAxis: { handler: this.renderPolarAxis },
        Customized: { handler: this.renderCustomized }
      } as any;

      // The "compact" mode is mainly used as the panorama within Brush
      if (compact) {
        return (
          <Surface {...attrs} width={width} height={height}>
            {this.renderClipPath()}
            {
              renderByOrder(children, map)
            }
          </Surface>
        );
      }

      const events = this.parseEventsOfWrapper();
      return (
        <div
          className={classNames('recharts-wrapper', className)}
          style={{ position: 'relative', cursor: 'default', width, height, ...style }}
          {...events}
          ref={(node) => { this.container = node; }}
        >
          <Surface {...attrs} width={width} height={height}>
            {this.renderClipPath()}
            {
              renderByOrder(children, map)
            }
          </Surface>
          {this.renderLegend()}
          {this.renderTooltip()}
        </div>
      );
    }
  }

  return CategoricalChartWrapper;
};

export default generateCategoricalChart;
