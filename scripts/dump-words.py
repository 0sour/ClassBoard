import pdfplumber

pdf = pdfplumber.open(r"D:\ClassBoard\严子辰(2026-2027-1)课表.pdf")
p = pdf.pages[0]
words = p.extract_words()
words.sort(key=lambda w: (round(w["top"] / 4), w["x0"]))
for w in words:
    print(f'{w["x0"]:6.1f} {w["x1"]:6.1f} {w["top"]:6.1f} {w["text"][:24]}')
