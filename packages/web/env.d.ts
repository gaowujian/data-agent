/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

/** tvision-charts-vue-next 未随 @data-agent/web 安装类型包，供 vue-tsc 解析 */
declare module "tvision-charts-vue-next" {
  import type { DefineComponent } from "vue";
  const TvisionTcharts: DefineComponent<object, object, unknown>;
  export default TvisionTcharts;
}
