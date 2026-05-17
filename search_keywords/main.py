import argparse
import sys
import tkinter as tk

from search_keywords.gui import SearchApp


def main():
    parser = argparse.ArgumentParser(
        description="多语言文本搜索器  在文件夹中搜索关键词")
    parser.add_argument("--folder", "-f",
                        help="初始搜索文件夹路径")
    args = parser.parse_args()

    root = tk.Tk()
    SearchApp(root, initial_folder=args.folder)
    root.mainloop()


if __name__ == "__main__":
    main()
