/**
 * 测试用的模块解析钩子：把应用里的 `@/` 别名映射到 `src/`。
 *
 * 为什么需要它：`node --test --experimental-strip-types` 不认识 tsconfig 的 paths，
 * 一旦被测模块（或其依赖）用 `@/...` 导入就会 ERR_MODULE_NOT_FOUND。此前测试因此只能
 * 挑没有 `@/` 依赖的模块来测，覆盖面被导入语句的写法牵着走。装上这个钩子之后，
 * 测试可以像应用代码一样直接 import 目标模块，不必为「可测」而改动生产导入。
 *
 * 用法：node --import ./tests/alias-loader.mjs --test ...
 * （package.json 的 test 脚本已经带上，单个测试文件手动跑时也建议带上。）
 */
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
