export const goalTypes = [
  { id: "bicycle", label: "Bicycle", illustration: "bicycle" },
  { id: "teddy", label: "Toy", illustration: "teddy" },
  { id: "books", label: "Books", illustration: "books" },
  { id: "paint", label: "Art Set", illustration: "paint" },
  { id: "console", label: "Game", illustration: "console" },
  {
    id: "custom",
    label: "Something else",
    illustration: "star_sparkle",
  },
] as const;

export type GoalType = (typeof goalTypes)[number];
