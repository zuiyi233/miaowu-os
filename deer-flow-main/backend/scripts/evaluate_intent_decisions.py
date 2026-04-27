from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path
from typing import Any


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text:
            continue
        try:
            item = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
    return rows


def _sample_rows(rows: list[dict[str, Any]], sample_size: int, seed: int) -> list[dict[str, Any]]:
    if len(rows) <= sample_size:
        return rows
    rng = random.Random(seed)
    return rng.sample(rows, sample_size)


def _export_sample(rows: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = output_dir / "intent_decisions_sample.jsonl"
    csv_path = output_dir / "intent_decisions_sample.csv"

    with jsonl_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            exported = {
                **row,
                "label_expected": row.get("label_expected") or "",
                "label_notes": row.get("label_notes") or "",
            }
            handle.write(json.dumps(exported, ensure_ascii=False) + "\n")

    fieldnames = [
        "ts",
        "intent",
        "execute_confidence",
        "qa_confidence",
        "ambiguity",
        "should_execute_now",
        "execution_mode_before",
        "confirmation_shown",
        "executed",
        "user_override",
        "label_expected",
        "label_notes",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row.get(name, "") for name in fieldnames})

    return jsonl_path, csv_path


def _compute_metrics(rows: list[dict[str, Any]]) -> dict[str, float]:
    if not rows:
        return {
            "false_block_rate": 0.0,
            "mis_execution_rate": 0.0,
            "confirmation_accuracy": 0.0,
        }

    false_block_count = 0
    false_block_total = 0
    mis_execution_count = 0
    mis_execution_total = 0
    confirmation_correct = 0
    confirmation_total = 0

    for row in rows:
        should_execute = bool(row.get("should_execute_now"))
        executed = bool(row.get("executed"))
        confirmation = bool(row.get("confirmation_shown"))
        user_override = bool(row.get("user_override"))

        # Approximation without manual labels:
        # - false block: execution suggested but not executed and user didn't override
        if should_execute:
            false_block_total += 1
            if not executed and not user_override:
                false_block_count += 1

        # - mis execution: executed while qa confidence significantly higher
        if executed:
            mis_execution_total += 1
            execute_conf = float(row.get("execute_confidence") or 0.0)
            qa_conf = float(row.get("qa_confidence") or 0.0)
            if qa_conf - execute_conf >= 0.12:
                mis_execution_count += 1

        # - confirmation accuracy: confirmation shown when not in execution mode and not executed yet
        if confirmation:
            confirmation_total += 1
            if not bool(row.get("execution_mode_before")) and not executed:
                confirmation_correct += 1

    return {
        "false_block_rate": round(false_block_count / false_block_total, 6) if false_block_total else 0.0,
        "mis_execution_rate": round(mis_execution_count / mis_execution_total, 6) if mis_execution_total else 0.0,
        "confirmation_accuracy": round(confirmation_correct / confirmation_total, 6) if confirmation_total else 0.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Sample and evaluate intent decision logs.")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("backend/.deer-flow/intent_decisions.jsonl"),
        help="Input JSONL path",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("backend/.deer-flow/eval"),
        help="Output directory for sample export",
    )
    parser.add_argument("--sample-size", type=int, default=500, help="Sample size")
    parser.add_argument("--seed", type=int, default=20260427, help="Random seed")
    args = parser.parse_args()

    rows = _load_jsonl(args.input)
    sampled = _sample_rows(rows, sample_size=max(1, args.sample_size), seed=args.seed)
    jsonl_path, csv_path = _export_sample(sampled, args.output_dir)
    metrics = _compute_metrics(sampled)

    print(f"input_rows={len(rows)} sampled_rows={len(sampled)}")
    print(f"sample_jsonl={jsonl_path}")
    print(f"sample_csv={csv_path}")
    print("metrics:")
    for key, value in metrics.items():
        print(f"  {key}={value}")


if __name__ == "__main__":
    main()
