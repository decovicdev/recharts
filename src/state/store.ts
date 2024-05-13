import { Action, combineReducers, configureStore, Dispatch } from '@reduxjs/toolkit';
import { optionsReducer } from './optionsSlice';
import { tooltipReducer } from './tooltipSlice';
import { chartDataReducer } from './chartDataSlice';
import { axisReducer } from './axisSlice';
import { chartLayoutReducer } from './layoutSlice';

const rootReducer = combineReducers({
  options: optionsReducer,
  tooltip: tooltipReducer,
  chartData: chartDataReducer,
  axis: axisReducer,
  layout: chartLayoutReducer,
});

export const createRechartsStore = (preloadedState?: Partial<RechartsRootState>, chartName: string = 'Chart') => {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
    devTools: {
      serialize: true,
      name: `recharts-${chartName}`,
    },
  });
};

export type RechartsRootState = ReturnType<typeof rootReducer>;
export type AppDispatch = Dispatch<Action>;
