"""Rebuild the OFL font subset; input is a verified, locally cached upstream TTF.
Requires FontTools 4.61.1. No network, credentials or runtime Python dependency.
"""
import hashlib
import pathlib
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = pathlib.Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest() == "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc"
font = TTFont(source, recalcTimestamp=False)
font = instantiateVariableFont(font, {"wght": 600}, inplace=True)
options = subset.Options()
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 9, 11, 13, 14, 16, 17]
options.name_legacy = True
options.name_languages = [0x409]
subsetter = subset.Subsetter(options=options)
subsetter.populate(text="歩香桂銀金角飛玉王と杏圭全馬龍１２３４５６７８９一二三四五六七八九▲△同打成不左右直引寄上投了中断千日手詰切負持将棋反則勝開始局面最大数引分入戦宣言来")
subsetter.subset(font)
names = {1: "Shogi Study Mincho", 2: "SemiBold", 3: "ShogiStudyMincho-SemiBold-1", 4: "Shogi Study Mincho SemiBold", 6: "ShogiStudyMincho-SemiBold", 16: "Shogi Study Mincho", 17: "SemiBold"}
for key, value in names.items():
    font["name"].setName(value, key, 3, 1, 0x409)
license_text = pathlib.Path("docs/licenses/NotoSerifJP-OFL.txt").read_bytes()
assert hashlib.sha256(license_text).hexdigest() == "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6"
# Keep the complete permission/copyright text with each downloaded font copy.
font["name"].setName(license_text.decode("utf-8"), 13, 3, 1, 0x409)
target = pathlib.Path("public/fonts/shogi-study-mincho.ttf")
target.parent.mkdir(parents=True, exist_ok=True)
font.recalcTimestamp = False
font.save(target)
print(f"{target}: {target.stat().st_size} bytes; SHA-256 {hashlib.sha256(target.read_bytes()).hexdigest()}")
