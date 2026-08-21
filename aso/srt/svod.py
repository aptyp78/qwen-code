"""Свод прогона: собирает журнал в читаемый отчёт и считает то, что считается машинно."""
import json, sys, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
прогон = sys.argv[1] if len(sys.argv) > 1 else "multi"
записи = [json.loads(s) for s in (HERE / f"journal_{прогон}.jsonl").read_text(encoding="utf-8").splitlines() if s.strip()]

корпуса = " ".join((HERE / "corpus" / f"{n}.md").read_text(encoding="utf-8").lower() for n in ("mmk", "taleb", "praktik"))

print(f"# Прогон: {прогон}\n")
старт = next(z for z in записи if z["событие"] == "старт")
print("Состав:", ", ".join(f"{p['id']} на {p['модель']}" for p in старт["состав"]), "\n")

итого_с, итого_т = 0, 0
for z in записи:
    if z["событие"] in ("предъявление", "вопросы", "правка") and "секунд" in z:
        итого_с += z["секунд"]; итого_т += z["токенов"]

print(f"Всего: {итого_с:.0f} секунд, {итого_т} токенов\n")
print("## Тексты\n")
for z in записи:
    if z["событие"] == "предъявление":
        print(f"### {z['позиция']} · предъявление · {z['модель']} · {z['секунд']}с\n")
        print(z["content"], "\n")
        if z["reasoning"]:
            print(f"_(размышление: {len(z['reasoning'])} символов, в журнале)_\n")

print("## Вопросы к содержанию\n")
for z in записи:
    if z["событие"] == "вопросы":
        print(f"### от {z['позиция']}\n")
        print(z["content"], "\n")

print("## Правка или удержание\n")
for z in записи:
    if z["событие"] == "правка":
        if "пропуск" in z:
            print(f"### {z['позиция']}: {z['пропуск']}\n"); continue
        исход = "ПЕРЕСТРОЕНО" if "ПЕРЕСТРОЕНО" in z["content"] else ("УДЕРЖАНО" if "УДЕРЖАНО" in z["content"] else "не заявлено")
        print(f"### {z['позиция']} · {исход} · {z['секунд']}с\n")
        print(z["content"], "\n")

# ── машинная часть критерия ─────────────────────────────────────────────────
print("## Что считается машинно\n")
перестроено = sum(1 for z in записи if z["событие"] == "правка" and "ПЕРЕСТРОЕНО" in z.get("content", ""))
удержано = sum(1 for z in записи if z["событие"] == "правка" and "УДЕРЖАНО" in z.get("content", ""))
пусто = sum(1 for z in записи if z.get("content") == "")
обрыв = sum(1 for z in записи if z.get("финиш") == "length")
print(f"- перестроено понятий: {перестроено}")
print(f"- удержано: {удержано}")
print(f"- пустых ответов: {пусто}")
print(f"- оборвано по бюджету: {обрыв}")

# кандидаты в новые понятия: слова, которых нет в корпусах
слова = set()
for z in записи:
    if z["событие"] in ("предъявление", "правка"):
        слова |= set(re.findall(r"[а-яё]{6,}", (z.get("content") or "").lower()))
новые = sorted(w for w in слова if w not in корпуса)
print(f"- слов длиннее 5 букв, которых нет в корпусах: {len(новые)}")
print(f"  {', '.join(новые[:40])}")
