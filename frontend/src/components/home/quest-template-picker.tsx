"use client";

import { Check } from "lucide-react";
import { questTemplates, type QuestTemplate } from "@/lib/quest-templates";
import { KidIllustration } from "./kid-ui";
import { StarValue } from "./home-ui";
import styles from "./quest-template-picker.module.css";

export function QuestTemplatePicker({
  value,
  disabled,
  onChange,
}: {
  value: QuestTemplate["id"] | null;
  disabled: boolean;
  onChange: (template: QuestTemplate) => void;
}) {
  return (
    <div className={styles.grid} role="group" aria-label="Choose a quest">
      {questTemplates.map((template) => (
        <button
          type="button"
          key={template.id}
          aria-pressed={value === template.id}
          disabled={disabled}
          onClick={() => onChange(template)}
        >
          <span className={styles.illustration}>
            <KidIllustration name={template.illustration} alt="" size={96} />
            {value === template.id && (
              <Check className={styles.selected} size={20} aria-hidden="true" />
            )}
          </span>
          <strong>{template.title}</strong>
          {template.stars ? (
            <StarValue compact>+{template.stars}</StarValue>
          ) : (
            <small>Write your own quest</small>
          )}
        </button>
      ))}
    </div>
  );
}
