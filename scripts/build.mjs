/**
 * Nexus 三重构建：
 * 1. lib/index.js —— host（Node）端插件，esm bundle；
 * 2. lib/client.js —— 浏览器端 client 插件，CJS 闭包工厂（loader 模块表消费）：
 *    banner/footer 按 @deepseek-ai/dsh-client-modules 协议包装
 *    (window.__ModuleLoader__.load({ id, factory: (require) => … }))，
 *    仅 react 走基线 externals，其余全部内联；
 * 3. lib/nexus-ui.js + lib/nexus.html —— /nexus 独立面板：
 *    浏览器 bundle 内联 react/react-dom，token CSS 与 JS 全内联成单个 HTML。
 */
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const id = pkg.name

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'lib/index.js',
  external: ['@deepseek-ai/*', 'zod', 'schemastery', 'node:*'],
})

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'cjs',
  outfile: 'lib/client.js',
  external: ['react', 'react/jsx-runtime'],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})

// /nexus 独立面板：react/react-dom 内联，其余运行时依赖外部化。
await build({
  entryPoints: ['src/ui/index.tsx'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  jsx: 'automatic',
  outfile: 'lib/nexus-ui.js',
  external: ['node:*', 'zod', 'schemastery', '@deepseek-ai/*'],
  minify: true,
  sourcemap: false,   // 曾内联 sourcemap：面板 HTML 里带着全部源码（隐私 + 体积）
})

// 组装单文件 HTML：token CSS + React bundle 全内联，renderShell 直接返回。
const theme = await readFile(new URL('../src/ui/theme.css', import.meta.url), 'utf8')
  + '\n' + await readFile(new URL('../src/ui/sample-palette.css', import.meta.url), 'utf8')
const uiJs = await readFile(new URL('../lib/nexus-ui.js', import.meta.url), 'utf8')
const safeJs = uiJs.replace(/<\/script/gi, '<\\/script')
const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nexus 记忆</title>
<style>
${theme}
</style>
</head>
<body>
<div id="root"></div>
<script>
${safeJs}
</script>
</body>
</html>
`
await writeFile(new URL('../lib/nexus.html', import.meta.url), html)

console.log('nexus: built lib/index.js + lib/client.js + lib/nexus-ui.js + lib/nexus.html')