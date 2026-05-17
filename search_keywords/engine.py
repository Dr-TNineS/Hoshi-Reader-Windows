import re
import threading
import time
import os


class SearchEngine:
    """文件搜索核心引擎  纯逻辑，不依赖 GUI。

    所有参数通过 run() 传入，结果通过回调产出，可独立测试复用。
    """

    def __init__(self):
        self._stop = threading.Event()
        self._lock = threading.Lock()

    def stop(self):
        self._stop.set()

    @property
    def stopped(self):
        return self._stop.is_set()

    # ------------------------------------------------------------------
    def run(self, folder, keywords, extensions, logic,
            use_regex, case_sensitive, context_lines,
            on_match, on_progress, on_error, on_done):
        """启动搜索（阻塞调用，应在工作线程中执行）。

        folder         - 搜索根目录
        keywords       - 关键词列表 [str, ...]
        extensions     - 扩展名列表 [".txt", ".srt", ...]
        logic          - "or" | "and"
        use_regex      - 是否正则模式
        case_sensitive - 是否区分大小写
        context_lines  - 上下文行数 (0 = 仅匹配行)

        回调签名:
          on_match(file_path, line_num, line_text, context_before, context_after)
          on_progress(current, total, file_path)
          on_error(file_path, msg)
          on_done(match_count, elapsed_seconds)
        """
        self._stop.clear()
        match_count = 0
        t0 = time.time()

        # ---- 编译匹配模式 ----
        flags = 0 if case_sensitive else re.IGNORECASE
        if use_regex:
            try:
                patterns = [re.compile(kw, flags) for kw in keywords]
            except re.error as e:
                on_error("", f"正则表达式错误: {e}")
                on_done(0, time.time() - t0)
                return
            targets = None
        else:
            patterns = None
            targets = keywords if case_sensitive else [kw.lower() for kw in keywords]

        # ---- 收集文件列表 ----
        try:
            ext_set = set(
                e.lower() if e.startswith(".") else f".{e.lower()}"
                for e in extensions
            )
            file_list = []
            for root_dir, dirs, files in os.walk(folder):
                if self._stop.is_set():
                    break
                for fn in files:
                    if os.path.splitext(fn)[1].lower() in ext_set:
                        file_list.append(os.path.join(root_dir, fn))
        except Exception as e:
            on_error("", f"无法遍历文件夹: {e}")
            on_done(0, time.time() - t0)
            return

        total = len(file_list)
        if total == 0:
            on_done(0, time.time() - t0)
            return

        ctx = context_lines

        # ---- 逐文件搜索 ----
        for idx, file_path in enumerate(file_list, 1):
            if self._stop.is_set():
                break
            on_progress(idx, total, file_path)

            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                    lines = fh.readlines()

                for i, raw_line in enumerate(lines):
                    if self._stop.is_set():
                        break
                    line = raw_line.rstrip("\n\r")

                    # 跳过 SRT 时间轴行
                    if re.match(
                        r"\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}", line
                    ):
                        continue

                    if self._match_line(line, patterns, targets, logic,
                                        use_regex, case_sensitive):
                        match_count += 1
                        before = lines[max(0, i - ctx):i]
                        after  = lines[i + 1:i + 1 + ctx]
                        on_match(file_path, i + 1, line, before, after)

            except Exception as e:
                on_error(file_path, str(e))

        on_done(match_count, time.time() - t0)

    # ------------------------------------------------------------------
    def _match_line(self, line, patterns, targets, logic,
                    use_regex, case_sensitive):
        if use_regex:
            hits = [p.search(line) is not None for p in patterns]
        else:
            cmp_line = line if case_sensitive else line.lower()
            hits = [t in cmp_line for t in targets]
        return all(hits) if logic == "and" else any(hits)

    # ------------------------------------------------------------------
    @staticmethod
    def highlight(line, keywords, use_regex):
        """返回带 [关键词] 标记的行。"""
        if use_regex:
            combined = "|".join(f"({kw})" for kw in keywords)
            try:
                return re.sub(combined, r"[\g<0>]", line, flags=re.IGNORECASE)
            except re.error:
                return line
        else:
            pattern = re.compile(
                "|".join(re.escape(kw) for kw in keywords), re.IGNORECASE
            )
            return pattern.sub(r"[\g<0>]", line)
