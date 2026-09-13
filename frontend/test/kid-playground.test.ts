import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KidPlayground } from "../src/components/home/screens/kid-profile-screen";

test("an empty showcase keeps the podium and animated name without inventing prizes", () => {
  const html = renderToStaticMarkup(
    createElement(KidPlayground, { items: [], childName: "Jasmine" }),
  );
  assert.match(html, /podium-new/);
  assert.match(html, /magic-name-reveal-wand/);
  assert.match(html, /Jasmine.*Toys/);
  assert.doesNotMatch(html, /kid-playground-prize-slot-/);
  assert.doesNotMatch(html, /No data for this section/);
});

test("earned items retain their original podium slots and leave the other slots empty", () => {
  const html = renderToStaticMarkup(
    createElement(KidPlayground, {
      childName: "Jasmine",
      items: [
        { slot: 1, title: "Bicycle", illustration: "bicycle" },
        { slot: 3, title: "Books", illustration: "books" },
      ],
    }),
  );
  assert.match(html, /podium-new/);
  assert.match(html, /kid-playground-prize-slot-1/);
  assert.match(html, /kid-playground-prize-slot-3/);
  assert.doesNotMatch(html, /kid-playground-prize-slot-[24]/);
  assert.match(html, /title="Bicycle"/);
  assert.match(html, /title="Books"/);
});
