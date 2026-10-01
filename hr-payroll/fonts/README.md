Payslip fonts are server-only Bolt `?bytes` assets. Noto fonts are licensed under the SIL Open Font License 1.1; see OFL.txt.

- Noto Sans Mono and Noto Sans Thai Regular: https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf
- Noto Sans JP/SC/TC: https://github.com/google/fonts/tree/main/ofl/notosansjp , https://github.com/google/fonts/tree/main/ofl/notosanssc , https://github.com/google/fonts/tree/main/ofl/notosanstc

The CJK TrueType files are static weight400 instances of the upstream variable fonts, pre-subset offline with fontTools into 512-codepoint ranges. Every upstream supported codepoint is retained across the ranges. JP, SC and TC retain regional glyph designs. The server-only index loads only ranges needed by the original names; those ranges are fully embedded because fontkit runtime subsets lose visible CJK glyphs. Latin and Thai remain runtime subsets. Fontkit positions shaped glyphs and PDFs retain the original Unicode text. Unsupported glyphs, illegibly long fields and files exceeding 4 MiB refuse export rather than corrupting identity or exceeding the file transport limit.
