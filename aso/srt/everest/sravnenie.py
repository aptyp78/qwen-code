"""Выбор машины под задачу выделения кейсов.

Эталона нет — разметить фрагменты вручную значит выполнить ту работу, которую
мы поручаем. Поэтому меряются четыре машинных признака, и главный из них —
согласие между разными машинами: оно не говорит, кто прав, но показывает,
где выдача надёжна, а где случай спорный.
"""
import json, re, time, urllib.request
from pathlib import Path

API = "http://127.0.0.1:11434/api/chat"
МОДЕЛИ = ["gemma4:12b-mlx", "gemma4:31b-mlx", "qwen3.8:27b-mlx", "muse-glimmer:30b-mxfp8-dflash"]
ПОВТОРОВ = 2
КОМПОНЕНТЫ = {"ОРУДИЕ", "МАШИНА", "ЦЕЛЬ", "ЗНАНИЕ", "ТАБЛО", "ОПЕРАЦИЯ"}

ЗАДАНИЕ = Path("vydelitel.py").read_text(encoding="utf-8").split('ЗАДАНИЕ = """')[1].split('"""')[0]
все = json.loads(Path("fragmenty.json").read_text(encoding="utf-8"))
# подвыборка: длинные фрагменты из разных частей книги
проба = [все[i] for i in (12, 21, 30, 37, 43, 48)]

def зов(модель, запрос, бюджет=1500):
    тело = json.dumps({"model": модель, "think": False, "stream": False,
                       "messages": [{"role": "user", "content": запрос}],
                       "options": {"num_predict": бюджет, "temperature": 0.3}}).encode()
    req = urllib.request.Request(API, data=тело, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.loads(r.read())
    return (d.get("message", {}).get("content") or "").strip(), round(time.time() - t0, 1)

норм = lambda s: re.sub(r"\s+", " ", s.lower().replace("ё", "е")).strip()

def разобрать(ответ, фрагмент):
    if ответ.strip().upper().startswith("НЕТ"):
        return {"исход": "нет-кейса"}
    к = (re.search(r"КОМПОНЕНТ:\s*(\w+)", ответ) or [None, ""])[1].strip().upper()
    ц = (re.search(r"ЦИТА\w*:\s*(.+)", ответ) or [None, ""])[1].strip().strip("«»\"' ")
    if not ц:
        m = re.search(r"«([^»]{20,})»", ответ); ц = m.group(1) if m else ""
    return {"исход": "кейс", "компонент": к,
            "компонент_валиден": к in КОМПОНЕНТЫ,
            "цитата_резолвится": bool(ц) and норм(ц) in норм(фрагмент)}

итоги = []
for мод in МОДЕЛИ:
    print(f"\n═══ {мод} ═══", flush=True)
    for i, ф in enumerate(проба):
        исходы = []
        for _ in range(ПОВТОРОВ):
            try:
                о, сек = зов(мод, f"{ЗАДАНИЕ}\n\n=== ОТРЫВОК ===\n{ф}")
                р = разобрать(о, ф); р["сек"] = сек
            except Exception as e:
                р = {"исход": f"ошибка: {e}", "сек": 0}
            р.update(модель=мод, проба=i)
            итоги.append(р); исходы.append(р)
        к = [x.get("компонент", "—") for x in исходы]
        ц = sum(1 for x in исходы if x.get("цитата_резолвится"))
        print(f"  проба {i}: {'/'.join(к):24} цитат ок {ц}/{ПОВТОРОВ}  "
              f"{'устойчиво' if len(set(к))==1 else 'ПЛАВАЕТ'}  {исходы[0]['сек']}с", flush=True)

Path("sravnenie.json").write_text(json.dumps(итоги, ensure_ascii=False, indent=1), encoding="utf-8")
print("\nготово")
