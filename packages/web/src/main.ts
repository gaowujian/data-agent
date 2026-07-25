/*
 * @Author: Andrew q
 * @Date: 2026-04-29 17:43:49
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-20 19:53:24
 * @Description: main
 */
import { createApp } from "vue";
import ElementPlus from "element-plus";
import TDesignChat from "@tdesign-vue-next/chat";
import "element-plus/dist/index.css";
import "@tdesign-vue-next/chat/es/style/index.css";
import App from "./App.vue";
import { router } from "./router";

const app = createApp(App);
app.use(ElementPlus);
app.use(TDesignChat);
app.use(router);
app.mount("#app");
