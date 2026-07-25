import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/agent',
  },
  {
    path: '/agent',
    component: () => import('../views/agent/index.vue'),
    name: 'Agent',
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
