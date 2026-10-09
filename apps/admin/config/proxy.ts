export default {
  dev: {
    '/api/v1': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    '/static': { target: 'http://127.0.0.1:3000', changeOrigin: false },
  },
};
