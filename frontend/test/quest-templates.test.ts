import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  questIllustration,
  questDescription,
  questTemplates,
  questTemplateValues,
} from "../src/lib/quest-templates";

test("quest picker presets match the illustrated choices and use existing kid assets", () => {
  assert.deepEqual(
    questTemplates
      .filter((template) => template.id !== "custom")
      .map(questTemplateValues),
    [
      { text: "Read for 30 minutes", stars: "3" },
      { text: "Clean your room", stars: "5" },
      { text: "Finish homework", stars: "4" },
    ],
  );
  for (const template of questTemplates) {
    assert.ok(
      existsSync(
        new URL(
          `../public/illustrations/kid/${template.illustration}.png`,
          import.meta.url,
        ),
      ),
    );
  }
});

test("custom quests start blank and editing form values cannot change the preset", () => {
  assert.deepEqual(questTemplateValues(questTemplates[3]), {
    text: "",
    stars: "",
  });
  const values: { text: string; stars: string } = questTemplateValues(
    questTemplates[0],
  );
  values.text = "Read with a sibling";
  values.stars = "8";
  assert.equal(questTemplates[0].title, "Read for 30 minutes");
  assert.equal(questTemplates[0].stars, "3");
});

test("indexed quest titles reuse their illustrations without guessing a custom quest's meaning", () => {
  assert.equal(questIllustration(" READ FOR 30 MINUTES "), "book");
  assert.equal(questIllustration("Clean your room"), "bed");
  assert.equal(questIllustration("Finish homework"), "pencil");
  assert.equal(questIllustration("Something personal"), "star_sparkle");
});

test("preview descriptions match exact presets and leave custom quest instructions to the parent", () => {
  assert.equal(
    questDescription(" READ FOR 30 MINUTES "),
    "Pick a book you love and read for at least 30 minutes.",
  );
  assert.equal(
    questDescription("Clean your room"),
    questTemplates[1].description,
  );
  assert.equal(
    questDescription("Finish homework"),
    questTemplates[2].description,
  );
  assert.equal(
    questDescription("Read to Grandma"),
    questTemplates[3].description,
  );
});
