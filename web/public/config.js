// 运行期配置。容器启动时由 docker-entrypoint.sh 从环境变量重新生成此文件；
// 本地开发与未经 entrypoint 处理时使用这份默认空配置（统计默认关闭）。
window.__RUNTIME_CONFIG__ = window.__RUNTIME_CONFIG__ || {};
