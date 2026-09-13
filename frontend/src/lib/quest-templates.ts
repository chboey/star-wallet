// Suggested form values only; assigned quests and rewards still come from the API.
export const questTemplates = [
  {
    id: "reading",
    title: "Read for 30 minutes",
    stars: "3",
    illustration: "book",
    description: "Pick a book you love and read for at least 30 minutes.",
  },
  {
    id: "room",
    title: "Clean your room",
    stars: "5",
    illustration: "bed",
    description:
      "Put away your toys and tidy your things to make your room neat.",
  },
  {
    id: "homework",
    title: "Finish homework",
    stars: "4",
    illustration: "pencil",
    description:
      "Finish your homework and check your work before asking your parent to review it.",
  },
  {
    id: "custom",
    title: "Something else",
    stars: "",
    illustration: "star_sparkle",
    description:
      "Follow your parent's instructions for this quest. Ask them if you need more details.",
  },
] as const;

export type QuestTemplate = (typeof questTemplates)[number];

function matchingQuestTemplate(title: string) {
  const normalized = title.trim().toLowerCase();
  return questTemplates.find(
    (template) =>
      template.id !== "custom" && template.title.toLowerCase() === normalized,
  );
}

export function questIllustration(title: string): string {
  return matchingQuestTemplate(title)?.illustration ?? "star_sparkle";
}

// The contract stores a title, not a separate description. These are preset
// instructions only; custom titles must not inherit another quest's instructions.
export function questDescription(title: string): string {
  return (
    matchingQuestTemplate(title)?.description ?? questTemplates[3].description
  );
}

export function questTemplateValues(template: QuestTemplate) {
  return {
    text: template.id === "custom" ? "" : template.title,
    stars: template.stars,
  };
}
