import json
import os
import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
from tkinter import ttk

from .engine import SearchEngine


class SearchApp:
    """搜索器 GUI 主类  负责界面构建、用户交互、引擎调度。"""

    def __init__(self, root, initial_folder=None):
        self.root = root
        self.engine = SearchEngine()
        self.q_results = queue.Queue()
        self.match_count = 0
        self.settings = self._load_settings()

        if initial_folder:
            self.settings["folder"] = initial_folder

        self._build_ui()
        self._bind_keys()
        self._poll_queue()

    # ==================================================================
    #  配置持久化
    # ==================================================================
    @staticmethod
    def _settings_path():
        return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "search_settings.json")

    def _load_settings(self):
        defaults = {
            "folder": "",
            "keywords": "",
            "extensions": ".txt, .srt",
            "logic": "or",
            "use_regex": False,
            "case_sensitive": False,
            "context_lines": 0,
            "output_file": os.path.join(
                os.path.expanduser("~"), "Desktop", "搜索结果.txt"
            ),
        }
        try:
            path = self._settings_path()
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                defaults.update(saved)
        except Exception:
            pass
        return defaults

    def _save_settings(self):
        data = {
            "folder": self.folder_var.get(),
            "keywords": self.kw_var.get(),
            "extensions": self.ext_var.get(),
            "logic": self.logic_var.get(),
            "use_regex": self.regex_var.get(),
            "case_sensitive": self.case_var.get(),
            "context_lines": self.ctx_var.get(),
            "output_file": self.out_var.get(),
        }
        try:
            with open(self._settings_path(), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    # ==================================================================
    #  UI 构建
    # ==================================================================
    def _build_ui(self):
        root = self.root
        root.title("多语言文本搜索器 v0.7.0")
        root.geometry("820x760")
        root.minsize(660, 600)
        root.configure(bg="#EAEDF2")
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        root.update_idletasks()
        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        root.geometry(f"820x760+{(sw - 820) // 2}+{(sh - 760) // 2}")

        self._setup_style()
        self._build_scroll_area()
        self._build_card_search()
        self._build_card_options()
        self._build_card_output()
        self._build_controls()
        self._build_progress()
        self._build_results()
        self._build_footer()

    def _setup_style(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")

        CARD  = "#FFFFFF"
        BG    = "#EAEDF2"
        ACC   = "#3B82F6"
        ACC_H = "#2563EB"
        DNG   = "#EF4444"
        DNG_H = "#DC2626"
        TXT   = "#1E293B"
        TXT2  = "#64748B"

        style.configure("Card.TFrame", background=CARD,
                        relief="solid", borderwidth=0)
        style.configure("Bg.TFrame",   background=BG)
        style.configure("H1.TLabel",   background=CARD, foreground=TXT,
                        font=("Microsoft YaHei", 12, "bold"))
        style.configure("Hint.TLabel", background=CARD, foreground=TXT2,
                        font=("Microsoft YaHei", 9))
        style.configure("Sect.TLabel", background=CARD, foreground=TXT,
                        font=("Microsoft YaHei", 10, "bold"),
                        width=14, anchor="w")
        style.configure("Status.TLabel", background=BG, foreground=TXT2,
                        font=("Microsoft YaHei", 9))
        style.configure("Stat.TLabel", background=BG, foreground=TXT,
                        font=("Microsoft YaHei", 9, "bold"))

        style.configure("Mod.TEntry", fieldbackground=CARD, foreground=TXT,
                        font=("Microsoft YaHei", 10), padding=8)

        style.configure("Pri.TButton", background=ACC, foreground="white",
                        font=("Microsoft YaHei", 10, "bold"),
                        borderwidth=0, padding=(22, 8), relief="flat")
        style.map("Pri.TButton",
            background=[("active", ACC_H), ("!disabled", ACC)],
            foreground=[("active", "white"), ("!disabled", "white")])

        style.configure("Dng.TButton", background=DNG, foreground="white",
                        font=("Microsoft YaHei", 10, "bold"),
                        borderwidth=0, padding=(22, 8), relief="flat")
        style.map("Dng.TButton",
            background=[("active", DNG_H), ("!disabled", DNG)],
            foreground=[("active", "white"), ("!disabled", "white")])

        style.configure("Out.TButton", background=CARD, foreground=ACC,
                        font=("Microsoft YaHei", 9), borderwidth=1,
                        padding=(12, 6))
        style.map("Out.TButton",
            background=[("active", "#EFF6FF"), ("!disabled", CARD)],
            bordercolor=[("active", ACC), ("!disabled", ACC)])

        style.configure("Mod.Horizontal.TProgressbar",
                        troughcolor="#E2E8F0", background=ACC,
                        thickness=8, borderwidth=0)

        style.configure("Mod.TRadiobutton", background=CARD,
                        foreground=TXT, font=("Microsoft YaHei", 10))
        style.configure("Mod.TCheckbutton", background=CARD,
                        foreground=TXT, font=("Microsoft YaHei", 10))

    def _build_scroll_area(self):
        self.canvas = tk.Canvas(self.root, bg="#EAEDF2", highlightthickness=0)
        self.canvas.pack(side="left", fill="both", expand=True)

        self.scroll_frame = ttk.Frame(self.canvas, style="Bg.TFrame")
        self.scroll_frame.bind("<Configure>",
            lambda e: self.canvas.configure(
                scrollregion=self.canvas.bbox("all")))

        self._canvas_win = self.canvas.create_window(
            (0, 0), window=self.scroll_frame, anchor="nw")

        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.canvas.bind("<MouseWheel>", self._on_mousewheel)

    def _on_canvas_configure(self, event):
        self.canvas.itemconfig(self._canvas_win, width=event.width)

    def _on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    # -- 卡片 1  搜索配置 ------------------------------------------------
    def _build_card_search(self):
        c = ttk.Frame(self.scroll_frame, style="Card.TFrame", padding=20)
        c.pack(fill="x", padx=15, pady=(15, 8))

        ttk.Label(c, text="搜索配置", style="H1.TLabel").pack(anchor="w")
        ttk.Separator(c, orient="horizontal").pack(fill="x", pady=(6, 12))

        # 文件夹
        row = ttk.Frame(c, style="Card.TFrame")
        row.pack(fill="x", pady=(0, 8))
        ttk.Label(row, text="文件夹", style="Sect.TLabel").pack(side="left")
        self.folder_var = tk.StringVar(value=self.settings["folder"])
        ef = ttk.Frame(row, style="Card.TFrame")
        ef.pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Entry(ef, textvariable=self.folder_var,
                  style="Mod.TEntry").pack(fill="x", expand=True)
        ttk.Button(row, text="浏览...", style="Out.TButton",
                   command=self._browse_folder).pack(side="right")

        # 关键词
        row = ttk.Frame(c, style="Card.TFrame")
        row.pack(fill="x", pady=(0, 4))
        ttk.Label(row, text="关键词", style="Sect.TLabel").pack(side="left")
        self.kw_var = tk.StringVar(value=self.settings["keywords"])
        ef = ttk.Frame(row, style="Card.TFrame")
        ef.pack(side="left", fill="x", expand=True)
        ttk.Entry(ef, textvariable=self.kw_var,
                  style="Mod.TEntry").pack(fill="x", expand=True)
        ttk.Label(c, text="多个关键词用逗号分隔",
                  style="Hint.TLabel").pack(
            anchor="w", padx=(120, 0), pady=(0, 8))

        # 匹配逻辑
        row = ttk.Frame(c, style="Card.TFrame")
        row.pack(fill="x")
        ttk.Label(row, text="匹配逻辑", style="Sect.TLabel").pack(side="left")
        self.logic_var = tk.StringVar(value=self.settings["logic"])
        fb = ttk.Frame(row, style="Card.TFrame")
        fb.pack(side="left")
        ttk.Radiobutton(fb, text="或 (任意)", variable=self.logic_var,
                        value="or",
                        style="Mod.TRadiobutton").pack(side="left", padx=(0, 16))
        ttk.Radiobutton(fb, text="且 (全部)", variable=self.logic_var,
                        value="and",
                        style="Mod.TRadiobutton").pack(side="left")

    # -- 卡片 2  高级选项 ------------------------------------------------
    def _build_card_options(self):
        c = ttk.Frame(self.scroll_frame, style="Card.TFrame", padding=20)
        c.pack(fill="x", padx=15, pady=8)

        ttk.Label(c, text="高级选项", style="H1.TLabel").pack(anchor="w")
        ttk.Separator(c, orient="horizontal").pack(fill="x", pady=(6, 12))

        # 文件扩展名
        row = ttk.Frame(c, style="Card.TFrame")
        row.pack(fill="x", pady=(0, 8))
        ttk.Label(row, text="文件类型", style="Sect.TLabel").pack(side="left")
        self.ext_var = tk.StringVar(value=self.settings["extensions"])
        ef = ttk.Frame(row, style="Card.TFrame")
        ef.pack(side="left", fill="x", expand=True)
        ttk.Entry(ef, textvariable=self.ext_var,
                  style="Mod.TEntry").pack(fill="x", expand=True)
        ttk.Label(c, text="扩展名以逗号分隔，如 .txt, .srt, .md, .log",
                  style="Hint.TLabel").pack(
            anchor="w", padx=(120, 0), pady=(0, 8))

        # 搜索模式 + 大小写
        row = ttk.Frame(c, style="Card.TFrame")
        row.pack(fill="x")
        ttk.Label(row, text="搜索模式", style="Sect.TLabel").pack(side="left")
        fb = ttk.Frame(row, style="Card.TFrame")
        fb.pack(side="left")
        self.regex_var = tk.BooleanVar(value=self.settings["use_regex"])
        self.case_var  = tk.BooleanVar(value=self.settings["case_sensitive"])
        ttk.Checkbutton(fb, text="正则模式", variable=self.regex_var,
                        style="Mod.TCheckbutton").pack(
            side="left", padx=(0, 12))
        ttk.Checkbutton(fb, text="区分大小写", variable=self.case_var,
                        style="Mod.TCheckbutton").pack(side="left")

        # 上下文行数
        row = ttk.Frame(c, style="Card.TFrame")
        row.pack(fill="x", pady=(6, 0))
        ttk.Label(row, text="上下文行", style="Sect.TLabel").pack(side="left")
        self.ctx_var = tk.IntVar(value=self.settings["context_lines"])
        sf = ttk.Frame(row, style="Card.TFrame")
        sf.pack(side="left")
        ttk.Spinbox(sf, from_=0, to=10, width=4, textvariable=self.ctx_var,
                    font=("Microsoft YaHei", 10)).pack(side="left")
        ttk.Label(sf, text="  (匹配行前后各显示 N 行)",
                  style="Hint.TLabel").pack(side="left")

    # -- 卡片 3  输出设置 ------------------------------------------------
    def _build_card_output(self):
        c = ttk.Frame(self.scroll_frame, style="Card.TFrame", padding=20)
        c.pack(fill="x", padx=15, pady=8)

        ttk.Label(c, text="输出设置", style="H1.TLabel").pack(anchor="w")
        ttk.Separator(c, orient="horizontal").pack(fill="x", pady=(6, 12))

        row = ttk.Frame(c, style="Card.TFrame")
        row.pack(fill="x")
        ttk.Label(row, text="输出文件", style="Sect.TLabel").pack(side="left")
        self.out_var = tk.StringVar(value=self.settings["output_file"])
        ef = ttk.Frame(row, style="Card.TFrame")
        ef.pack(side="left", fill="x", expand=True, padx=(0, 8))
        ttk.Entry(ef, textvariable=self.out_var,
                  style="Mod.TEntry").pack(fill="x", expand=True)
        ttk.Button(row, text="选择...", style="Out.TButton",
                   command=self._browse_output).pack(side="right")

    # -- 控制按钮 -------------------------------------------------------
    def _build_controls(self):
        bar = ttk.Frame(self.scroll_frame, style="Bg.TFrame")
        bar.pack(fill="x", padx=15, pady=(12, 4))

        self.start_btn = ttk.Button(bar, text="开始搜索",
                                     style="Pri.TButton",
                                     command=self._start_search)
        self.start_btn.pack(side="left", padx=(0, 10))

        self.stop_btn = ttk.Button(bar, text="终止搜索",
                                    style="Dng.TButton",
                                    command=self._stop_search)
        self.stop_btn.pack(side="left")

        ttk.Button(bar, text="清空结果", style="Out.TButton",
                   command=self._clear_results).pack(side="right")

    # -- 进度 + 统计 ----------------------------------------------------
    def _build_progress(self):
        pf = ttk.Frame(self.scroll_frame, style="Bg.TFrame")
        pf.pack(fill="x", padx=15, pady=(4, 4))
        self.progress_var = tk.DoubleVar()
        ttk.Progressbar(pf, variable=self.progress_var,
                        style="Mod.Horizontal.TProgressbar").pack(fill="x")

        sf = ttk.Frame(self.scroll_frame, style="Bg.TFrame")
        sf.pack(fill="x", padx=15, pady=(0, 6))
        self.status_lbl = ttk.Label(sf, text="就绪", style="Status.TLabel")
        self.status_lbl.pack(side="left")
        sr = ttk.Frame(sf, style="Bg.TFrame")
        sr.pack(side="right")
        self.files_lbl   = ttk.Label(sr, text="文件: 0", style="Stat.TLabel")
        self.files_lbl.pack(side="left", padx=(0, 12))
        self.matches_lbl = ttk.Label(sr, text="匹配: 0", style="Stat.TLabel")
        self.matches_lbl.pack(side="left", padx=(0, 12))
        self.time_lbl    = ttk.Label(sr, text="耗时: 0s", style="Stat.TLabel")
        self.time_lbl.pack(side="left")

    # -- 结果展示 -------------------------------------------------------
    def _build_results(self):
        c = ttk.Frame(self.scroll_frame, style="Card.TFrame",
                      padding=(20, 20, 20, 10))
        c.pack(fill="both", expand=True, padx=15, pady=(4, 10))

        ttk.Label(c, text="搜索结果", style="H1.TLabel").pack(anchor="w")
        ttk.Separator(c, orient="horizontal").pack(fill="x", pady=(6, 8))

        ft = ttk.Frame(c, style="Card.TFrame")
        ft.pack(fill="both", expand=True)

        self.result_box = scrolledtext.ScrolledText(
            ft, width=90, height=14, font=("Consolas", 10), wrap=tk.NONE,
            bg="#F8FAFC", fg="#1E293B", insertbackground="black",
            relief="solid", borderwidth=1, padx=8, pady=8)
        self.result_box.pack(side="left", fill="both", expand=True)
        self.result_box.configure(state="disabled")

        ysb = ttk.Scrollbar(ft, orient="vertical",
                            command=self.result_box.yview)
        ysb.pack(side="right", fill="y")
        self.result_box.configure(yscrollcommand=ysb.set)

        xsb = ttk.Scrollbar(c, orient="horizontal",
                            command=self.result_box.xview)
        xsb.pack(fill="x")
        self.result_box.configure(xscrollcommand=xsb.set)

        self.result_box.tag_config(
            "file", foreground="#3B82F6", font=("Consolas", 10, "bold"))
        self.result_box.tag_config(
            "match", foreground="#DC2626", font=("Consolas", 10, "bold"))
        self.result_box.tag_config(
            "ctx", foreground="#94A3B8", font=("Consolas", 9))
        self.result_box.tag_config("error", foreground="#EF4444")

    # -- 底部状态栏 -----------------------------------------------------
    def _build_footer(self):
        self.footer = tk.Frame(self.root, bg="#1E293B", height=26)
        self.footer.pack(side="bottom", fill="x")
        self.footer.pack_propagate(False)
        self.footer_lbl = tk.Label(
            self.footer, text="就绪 | Ctrl+Enter 搜索 | Esc 终止",
            bg="#1E293B", fg="#94A3B8",
            font=("Microsoft YaHei", 8), anchor="w", padx=12)
        self.footer_lbl.pack(fill="x")

    # ==================================================================
    #  键盘 & 对话框
    # ==================================================================
    def _bind_keys(self):
        self.root.bind("<Key>", self._on_key)

    def _on_key(self, event):
        if event.state & 0x4 and event.keysym == "Return":
            self._start_search()
            return "break"
        if event.keysym == "Escape":
            self._stop_search()
            return "break"
        if event.state & 0x4 and event.keysym.lower() == "o":
            self._browse_folder()
            return "break"

    def _browse_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            self.folder_var.set(folder)

    def _browse_output(self):
        f = filedialog.asksaveasfilename(
            defaultextension=".txt", filetypes=[("Text files", "*.txt")])
        if f:
            self.out_var.set(f)

    # ==================================================================
    #  搜索生命周期
    # ==================================================================
    def _start_search(self):
        self._save_settings()

        folder = self.folder_var.get().strip()
        raw_kw  = self.kw_var.get().strip()
        raw_ext = self.ext_var.get().strip()
        output  = self.out_var.get().strip()
        logic   = self.logic_var.get()
        regex   = self.regex_var.get()
        case    = self.case_var.get()
        ctx     = self.ctx_var.get()

        if not folder:
            messagebox.showerror("错误", "请选择搜索文件夹！")
            return
        keywords = [k.strip() for k in raw_kw.split(",") if k.strip()]
        if not keywords and not regex:
            messagebox.showerror("错误", "请输入至少一个关键词！")
            return
        extensions = [e.strip() for e in raw_ext.split(",") if e.strip()]
        if not extensions:
            extensions = [".txt", ".srt"]

        # 写出输出文件头
        try:
            with open(output, "w", encoding="utf-8") as f:
                f.write(f"# 搜索配置\n")
                f.write(f"# 文件夹: {folder}\n")
                f.write(f"# 关键词: {raw_kw}\n")
                f.write(f"# 逻辑: {logic} | 正则: {regex}"
                        f" | 大小写: {case} | 上下文: {ctx}\n")
                f.write(f"# {'=' * 60}\n\n")
        except Exception as e:
            messagebox.showerror("错误", f"无法写入输出文件: {e}")
            return

        # 清空结果面板
        self.result_box.configure(state="normal")
        self.result_box.delete(1.0, tk.END)
        self.result_box.configure(state="disabled")
        self.match_count = 0
        self._update_stats(0, 0, 0)

        self.start_btn.configure(state="disabled")
        self.footer_lbl.config(text="搜索中...")

        thread = threading.Thread(
            target=self.engine.run,
            args=(folder, keywords, extensions, logic,
                  regex, case, ctx,
                  self._on_match, self._on_progress,
                  self._on_error, self._on_done),
            daemon=True)
        thread.start()

    def _stop_search(self):
        self.engine.stop()
        self.footer_lbl.config(text="正在终止...")

    # -- 引擎回调（工作线程  > 队列  > GUI 线程消费）-------------------
    def _on_match(self, fp, ln, text, before, after):
        self.q_results.put(("match", fp, ln, text, before, after))

    def _on_progress(self, cur, tot, fp):
        self.q_results.put(("progress", cur, tot, fp))

    def _on_error(self, fp, msg):
        self.q_results.put(("error", fp, msg))

    def _on_done(self, mc, elapsed):
        self.q_results.put(("done", mc, elapsed))

    # -- 队列消费（仅在 GUI 线程执行）-----------------------------------
    def _poll_queue(self):
        box = self.result_box
        keywords = [k.strip() for k in self.kw_var.get().split(",")
                    if k.strip()]
        regex = self.regex_var.get()

        while not self.q_results.empty():
            item = self.q_results.get()
            kind = item[0]

            if kind == "progress":
                _, cur, tot, fp = item
                pct = cur / tot * 100 if tot else 0
                self.progress_var.set(pct)
                self.status_lbl.config(
                    text=f"处理中 {cur}/{tot}: {os.path.basename(fp)}")
                self._update_stats(tot, self.match_count, 0)

            elif kind == "match":
                _, fp, ln, text, before, after = item
                self.match_count += 1
                hl = SearchEngine.highlight(text, keywords, regex)
                box.configure(state="normal")
                s = box.index(tk.END)
                box.insert(tk.END, f"  {fp}\n")
                box.tag_add("file", s, box.index(tk.END))
                for bl in before:
                    s = box.index(tk.END)
                    box.insert(tk.END, f"    ... {bl.rstrip()}\n")
                    box.tag_add("ctx", s, box.index(tk.END))
                s = box.index(tk.END)
                box.insert(tk.END, f"    > L{ln}: {hl}\n")
                box.tag_add("match", s, box.index(tk.END))
                for al in after:
                    s = box.index(tk.END)
                    box.insert(tk.END, f"    ... {al.rstrip()}\n")
                    box.tag_add("ctx", s, box.index(tk.END))
                box.insert(tk.END, "\n")
                box.configure(state="disabled")
                box.see(tk.END)

                try:
                    with open(self.out_var.get(), "a",
                              encoding="utf-8") as f:
                        f.write(f"{fp} L{ln}: {hl}\n")
                except Exception:
                    pass

            elif kind == "error":
                _, fp, msg = item
                box.configure(state="normal")
                s = box.index(tk.END)
                box.insert(tk.END, f"X {fp}: {msg}\n")
                box.tag_add("error", s, box.index(tk.END))
                box.configure(state="disabled")

            elif kind == "done":
                _, match_count, elapsed = item
                output = self.out_var.get()
                if self.engine.stopped:
                    self.status_lbl.config(
                        text=f"搜索已终止 - 找到 {match_count} 处匹配")
                    self.footer_lbl.config(
                        text=f"已终止 | 匹配 {match_count}"
                             f" | 耗时 {elapsed:.1f}s")
                    messagebox.showinfo(
                        "已终止",
                        f"搜索已终止！\n"
                        f"匹配: {match_count} 处\n"
                        f"耗时: {elapsed:.1f}s")
                else:
                    self.status_lbl.config(
                        text=f"搜索完成 - 共 {match_count} 处匹配")
                    self.footer_lbl.config(
                        text=f"完成 | 匹配 {match_count}"
                             f" | 耗时 {elapsed:.1f}s")
                    messagebox.showinfo(
                        "完成",
                        f"搜索完成！\n"
                        f"匹配: {match_count} 处\n"
                        f"耗时: {elapsed:.1f}s\n"
                        f"结果: {output}")
                self.progress_var.set(100)
                self._update_stats(0, match_count, elapsed)
                self.start_btn.configure(state="normal")
                self._save_settings()

        self.root.after(100, self._poll_queue)

    def _clear_results(self):
        self.result_box.configure(state="normal")
        self.result_box.delete(1.0, tk.END)
        self.result_box.configure(state="disabled")
        self._update_stats(0, 0, 0)
        self.status_lbl.config(text="就绪")

    def _update_stats(self, files, matches, elapsed):
        self.files_lbl.config(text=f"文件: {files}")
        self.matches_lbl.config(text=f"匹配: {matches}")
        self.time_lbl.config(text=f"耗时: {elapsed:.1f}s")

    def _on_close(self):
        self.engine.stop()
        self._save_settings()
        self.root.destroy()
