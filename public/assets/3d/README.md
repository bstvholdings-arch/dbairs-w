# 3D 素材目录（`public/assets/3d/`）

前台所有 Three.js 素材的唯一存放位置。**下载的模型、贴图、环境图都放这里**，
不要散落到 `public/` 根目录、也不要用项目外的绝对路径（`file://` / `C:\...`）引用。

## 磁盘红线（本机）

| 位置 | 用途 | 规则 |
| --- | --- | --- |
| `D:\dbairs-w\public\assets\3d\` | 模型 / 贴图 / 环境图 | **只能放这里** |
| `D:\dbairs-w\node_modules\` | npm 依赖 | 由 `npm install` 写入，已在 D 盘 |
| `D:\dbairs-w\.npm-cache\` | npm 缓存 | 由项目 `.npmrc` 强制指向 D 盘 |
| `D:\dbairs-w\.npm-tmp\` | 安装临时解包 | 安装前 `$env:TEMP='D:\dbairs-w\.npm-tmp'; $env:TMP=$env:TEMP` |

本机 C 盘只剩不到 8GB，**任何**下载的模型 / 贴图 / 缓存都不许写 `C:\`（包括桌面、
`Downloads`、`%TEMP%`、全局 npm 缓存）。下载完先 `Move-Item` 到本目录，再在代码里引用。

## 目录约定

```
public/assets/3d/
├─ models/            # 模型：*.glb 优先
│  ├─ branding/       #   站点品牌物（Logo 立体字、吉祥物）
│  ├─ games/          #   品类 / 游戏封面立体件（骰子、牌桌、转盘）
│  └─ ui/             #   交互动效件（金币、宝箱、奖杯）
├─ textures/          # 贴图：webp / ktx2 优先（png / jpg 仅兜底）
├─ env/               # HDRI 环境光照（*.hdr / *.exr，尽量 < 2MB）
└─ README.md
```

命名统一 `小写-连字符`，不要中文 / 空格 / 版本号堆叠：
`models/ui/coin-stack.glb`、`textures/ui/coin-stack-albedo.webp`。

## 格式与体积预算

| 项 | 要求 | 上限 |
| --- | --- | --- |
| 模型 | **`.glb`（单文件自带贴图）优先**；`.gltf` + 外部 `.bin` 只在必须改材质时用 | 8 MB / 个 |
| 压缩 | 网格用 **Draco** 或 **meshopt**；动画烘焙到骨骼，不要在运行时算 | — |
| 贴图 | **`.webp`**（兼容性够、体积约为 png 的 1/5）；需要 GPU 压缩纹理时用 `.ktx2` | 4 MB / 张 |
| 环境图 | `.hdr` 先用 `hdri-to-jpg` 之类的工具降到 1K–2K | 2 MB / 张 |
| 单场景合计 | 模型 + 贴图 + 环境图 | 24 MB |

超过预算的处理顺序：① Draco / meshopt 压缩 → ② 降贴图分辨率与通道数 → ③ 拆场景按需加载 →
④ **改走对象存储 + CDN**（此时用 `resolveThreeAssetUrl()` 的 `https://...` 直链分支，文件不进仓库）。

## 代码里怎么引用（禁止手写路径）

```tsx
import { ModelViewer } from "@/components/three/model-viewer";

// 相对素材根目录 → 自动解析成 /assets/3d/models/ui/coin-stack.glb
<ModelViewer src="models/ui/coin-stack.glb" className="aspect-square w-full" />

// 自定义场景（灯光 / 多模型 / 交互）
import { SceneCanvas } from "@/components/three/scene-canvas";

<SceneCanvas className="h-64 w-full">
  <ambientLight intensity={0.8} />
  {/* 场景内容 */}
</SceneCanvas>
```

- 路径解析**只有一份实现**：`src/lib/three-assets.ts` 的 `resolveThreeAssetUrl()`
  （相对路径补 `/assets/3d/`、`https://` 直链放行、`javascript:` / `data:` / `//host` / `..` 一律拒绝）。
- `SceneCanvas` / `ModelViewer` 都通过 `next/dynamic({ ssr: false })` 懒加载 three + fiber + drei，
  **禁止**在页面里直接 `import { Canvas } from "@react-three/fiber"` —— 那会把 3D 引擎塞进首屏 bundle。
- 容器**必须自带高度**（`h-64` / `aspect-square` / `min-h-[320px]`），否则 WebGL 画布高度为 0。
- 系统开启「减弱动态效果」（`prefers-reduced-motion`）时自动降级为静态渲染一帧，无需各自判断。

## 素材来源与授权

- 只允许使用**可商用**素材：Poly Haven（CC0）、Quaternius（CC0）、Kenney（CC0）、
  或已购买授权的商用模型库；
- 每个新素材在本文件末尾补一行来源与许可，便于后续审计：

| 文件 | 来源 | 许可 | 备注 |
| --- | --- | --- | --- |
| （示例）`models/ui/dice.glb` | Poly Haven | CC0 | 6 面骰，无动画 |
| `models/ui/demo-cube.glb` | 本项目生成（一次性脚本手写 GLB） | 自有 | 1.6KB / 24 顶点 / 36 索引，`/demo/three` 联调页专用，不承载任何业务 |

## 联调页：`/demo/three`

改完 `src/components/three/*`、换了显卡 / 浏览器，或新机器上第一次跑 3D 时，先开这一页：

```
http://localhost:3000/demo/three
```

- 左边 `SceneCanvas`：纯 JSX 图元（不下载任何素材文件）。**这里空白 = 容器高度或 WebGL 上下文的问题**，与素材无关；
- 右边 `ModelViewer`：加载 `models/ui/demo-cube.glb`。左边正常、右边空白 = 素材路径或 `.glb` 文件本身的问题
  （开发环境控制台会有 `[three]` 警告）；
- 该页**不需要登录、不需要 `?tenant=`、不查库**，但路径登记在 `src/proxy.ts` 的 `PUBLIC_PREVIEW_PATHS` 里
  （常量 `THREE_DEMO_PATH`）—— 不登记的话未登录访问会被登录校验重定向到 `/login`。
- 新增同类「公开预览 / 联调页」时，同样只在那份白名单里加一个常量；`tmp-*` 一次性脚本**不要**登记（用完即删）。

## 提交与部署

- 模型是**部署资产**：`public/` 下的文件必须进仓库（Vercel 只会部署仓库里的内容），
  所以引入新模型时请先复核体积预算，超 8MB 的模型不要提交；
- `.gitignore` 已忽略 `.npm-cache/` / `.npm-tmp/`，**没有**忽略 `public/assets/3d/`；
- 生产环境如走 CDN，把域名写进 `resolveThreeAssetUrl()` 的直链分支即可，组件不用改。
