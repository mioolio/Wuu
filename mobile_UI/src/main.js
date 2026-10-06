import { createApp } from 'vue';
import App from './App.vue';
import './styles/main.css';
import { initializeTheme } from './composables/useTheme.js';

initializeTheme();
createApp(App).mount('#app');
