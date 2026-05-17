# 多语言文本搜索器

在文件夹中快速搜索关键词的桌面工具，纯 Python + tkinter 实现。

## 功能

- 关键词搜索（AND / OR 逻辑）
- 正则表达式模式
- 上下文行显示（匹配行前后 N 行）
- 可配置文件类型（.txt / .srt / .md / .log ...）
- 区分大小写开关
- 结果实时展示 + 导出文本文件
- 配置自动记忆
- 键盘快捷键（Ctrl+Enter 搜索，Esc 终止）
- Windows 右键菜单集成

## 运行

```bash
cd "New project"
python -m search_keywords.main
```

指定初始文件夹：

```bash
python -m search_keywords.main --folder "D:\小说合集"
```

## 项目结构

```
search_keywords/
├── __init__.py      # 包入口
├── engine.py        # 搜索引擎（纯逻辑，无 GUI 依赖）
├── gui.py           # 图形界面（SearchApp）
└── main.py          # 启动入口（CLI 参数解析）
```

## 安装右键菜单（Windows）

以管理员身份运行 PowerShell：

```powershell
.\install_context_menu.ps1
```

之后在任意文件夹上右键 > "用搜索器搜索..." 即可启动。

卸载：

```powershell
.\uninstall_context_menu.ps1
```

## 依赖

- Python 3.8+
- 标准库（无需 pip install）

## License

MIT
