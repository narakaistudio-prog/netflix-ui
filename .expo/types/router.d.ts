/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string = string> extends Record<string, unknown> {
      StaticRoutes: `/` | `/(profile)/profile` | `/(tabs)` | `/(tabs)/` | `/(tabs)/(profile)/profile` | `/(tabs)/new` | `/(tabs)/profile` | `/_sitemap` | `/admin` | `/downloads` | `/new` | `/profile` | `/search` | `/switch-profile` | `/visionOS`;
      DynamicRoutes: `/browse/${Router.SingleRoutePart<T>}` | `/movie/${Router.SingleRoutePart<T>}`;
      DynamicRouteTemplate: `/browse/[rowTitle]` | `/movie/[id]`;
    }
  }
}
