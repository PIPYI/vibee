// Audience presentation instructions (docs/v2_plan.md §4.4, §12.3). Authored
// in the SAME composition-stage tool call as architecture-composition-contract.ts
// -- there is no separate repository analysis or separate AI call for the
// technical profile. This section only tells the model how to fill in each
// component/boundary/connection's optional `presentation` field on the one
// canonical document it is already composing.
export function audiencePresentationContract(): string {
  return `## Audience presentation (same document, two profiles)

\`simple\` is the default audience. Every component/boundary/connection can carry an optional \`presentation: { simple?, technical? }\` override -- author both profiles' overrides as part of this same composition step, not as a second pass over the repository.

- **Simple labels are role/action-first and hide technical jargon by default.** Framework, library, protocol, vendor, and package names are hidden from the simple canvas by default -- prefer "무엇을 하는가" (what it does) over "무엇으로 만들었는가" (what it's built with). "AWS S3" becomes "사진 저장소"; "POST /api/photos" becomes "사진 업로드".
- **Technical keeps the canonical label and implementation detail.** The base \`label\`/\`sublabel\` you set on the component itself already serve as the technical view's content -- only add a \`presentation.technical\` override when you want to add detail beyond that.
- **Presentation overrides never change semantic topology or geometry.** A \`presentation\` override may only change \`label\`, \`sublabel\`, or \`visibility\` -- it must never change a component's \`id\`, \`semanticRefs\`, \`pos\`, \`size\`, or a connection's \`from\`/\`to\`. Simple and technical share the same semantic identity and the same canonical geometry; only what's drawn on top of that shared geometry differs.
- **No per-profile grouping in this version.** Do not set \`semanticRefs\` to more than one id to merge several semantic entities into one simple-profile node -- keep exactly one semantic identity per component in both profiles.
- \`visibility: "hide"\` is allowed on a low-value technical-only element in the simple profile, but do not recompute or shift any other shared element's \`pos\`/\`size\` to fill the resulting gap -- leftover whitespace in simple is acceptable in this version.
- Shared elements keep the same position across both profiles so a reader recognizes the same system when switching tabs -- this is exactly why coordinates are authored once (Stage 2) rather than once per profile. There is no profile-specific topology generation: simple and technical are two projections of one graph, never two independently generated graphs.`;
}
