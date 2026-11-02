/**
 * 词典一致性校验（零依赖，直接 node 跑）：
 *   npm run i18n:check
 *
 * 校验四件事，任何一项失败都以退出码 1 结束（可直接进 CI）：
 *   1. zh.json / en.json 的 key 集合完全一致（中文是唯一事实来源，见 src/lib/i18n-types.ts）；
 *   2. 两个词典都没有空值；
 *   3. en.json 里没有残留的中日韩字符（漏译会退回中文）；
 *   4. 源码里 t("xxx") 以及常量表里引用的 key，都在词典中存在。
 *
 * 为什么不用 TypeScript 兜住第 1、2 条：t() 的 key 类型只约束 zh.json，
 * en.json 少一条不会报错，只会在运行时静默回落中文。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LOCALE_DIR = path.join(ROOT, "src", "locales");
const SRC_DIR = path.join(ROOT, "src");
const CJK = /[\u3400-\u9FFF\u3000-\u303F\uFF01-\uFF60]/;

/** @type {Record<string, Record<string, string>>} */
const dict = {};

for (const lang of ["zh", "en"]) {
  dict[lang] = JSON.parse(
    fs.readFileSync(path.join(LOCALE_DIR, `${lang}.json`), "utf8"),
  );
}

const failures = [];

const zhKeys = Object.keys(dict.zh);
const enKeys = Object.keys(dict.en);
const zhSet = new Set(zhKeys);
const enSet = new Set(enKeys);

// 1. key 对齐
for (const key of zhKeys) {
  if (!enSet.has(key)) failures.push(`en.json 缺少词条：${key}`);
}
for (const key of enKeys) {
  if (!zhSet.has(key)) failures.push(`zh.json 缺少词条：${key}`);
}

// 2. 空值
for (const lang of ["zh", "en"]) {
  for (const [key, value] of Object.entries(dict[lang])) {
    if (!String(value ?? "").trim()) failures.push(`${lang}.json 词条为空：${key}`);
  }
}

// 3. en 里的中文残留
for (const [key, value] of Object.entries(dict.en)) {
  if (CJK.test(String(value))) failures.push(`en.json 未翻译（含中文）：${key}`);
}

// 4. 源码引用是否都存在
const PREFIXES = new Set(zhKeys.map((key) => key.split(".")[0]));
const files = [];

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
})(SRC_DIR);

const DOTTED = /["']([A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+){1,5})["']/g;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);
  for (const match of text.matchAll(DOTTED)) {
    const candidate = match[1];
    // 只把「首段等于某个已知词条前缀」的字符串当作 key，
    // 这样 example.com / qrcode.react 这类字面量不会被误判。
    if (!PREFIXES.has(candidate.split(".")[0])) continue;
    if (!zhSet.has(candidate) || !enSet.has(candidate)) {
      failures.push(`${relative} 引用了不存在的词条：${candidate}`);
    }
  }
}

if (failures.length) {
  console.error(`✗ i18n 校验失败，共 ${failures.length} 处：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `✓ i18n 校验通过：zh ${zhKeys.length} 键 / en ${enKeys.length} 键，均非空、无未翻译、源码引用全部命中。`,
);
