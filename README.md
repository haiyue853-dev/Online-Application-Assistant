# 网申助手

一个本地优先、AI 辅助的 Chrome / Edge 网申表单填写扩展。上传 PDF、DOCX 或 TXT 简历后，扩展会生成可编辑的资料模板；打开招聘官网时，可以用本地规则和 AI 补充匹配自动填写表单。

## 功能

- PDF、DOCX、TXT 简历解析并保存为本地模板
- 多套简历模板导入、导出和切换
- 姓名、电话、邮箱、学校、专业、日期、下拉框、单选框等常见字段填写
- 本地规则优先，只有未匹配字段才请求 AI
- DeepSeek、OpenAI、通义千问、Kimi、智谱 GLM、SiliconFlow 快捷预设
- 任意 OpenAI Chat Completions 兼容接口
- 点击资料字段手动填入当前网页输入框
- 填写结果高亮、未填写字段提示和诊断摘要
- 密码、验证码和文件上传字段自动跳过

扩展不会自动点击“提交申请”“下一步”“删除”或“同意协议”。

## 安装

1. 下载或克隆本仓库。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本仓库中包含 `manifest.json` 的目录。

如果网申页面在安装前已经打开，请刷新页面。

## 使用

1. 点击浏览器工具栏中的“网申助手”，打开管理页。
2. 在“AI 配置”中选择服务商，填写 API Key，并点击“获取模型”或手动填写模型名。
3. 在“模板管理”中上传 PDF、DOCX 或 TXT 简历。
4. 检查 AI 提取的资料，必要时导出 Excel 修改后重新导入。
5. 打开招聘官网，在右侧面板选择模板并点击“一键 AI 填写”。
6. 完整检查填写结果，补充附件，然后由你手动提交。

服务商不在预设列表时，选择“自定义 OpenAI 兼容接口”，填写完整的 Chat Completions 地址即可。

## 本地测试页面

在项目目录启动静态服务器：

```powershell
python -m http.server 8000
```

然后打开 `http://localhost:8000/demo/form.html`。该页面包含文本框、日期、下拉框、单选框、已有内容、密码和文件上传字段，可快速检查扩展行为。

## 隐私

- 简历模板、个人资料和 AI 配置保存在浏览器扩展本地存储中。
- 一键填写时，只把未由本地规则匹配的网页字段和相关简历分组发给你配置的 AI 服务商。
- 解析简历时，PDF / DOCX 会先在本地提取文字，提取后的文字会发送给所选 AI 服务商。
- API Key 会直接用于请求所选服务商；项目没有自建中转服务器。
- 备份默认不包含 API Key；密码、验证码、令牌等字段会被过滤。

## 开发

扩展本身没有构建步骤。测试和类型检查需要 Node.js：

```powershell
npm install
npm test
npm run typecheck
```

## 来源与许可

本项目基于 [TshyGO/resume-form-assistant-plugin](https://github.com/TshyGO/resume-form-assistant-plugin) 的 MIT 许可代码精简和二次开发，保留原项目版权与许可证声明。详见 [LICENSE](LICENSE)。
