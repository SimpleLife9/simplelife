# SimpleLife Inbox — first-party local statistical model card

**Revision:** 2026-11-28
**Processor:** `inbox-tfidf-hybrid-v1`
**Artifact:** `supabase/functions/_shared/inbox-tfidf-model.json`
**Artifact SHA-256:** `C01B1026B4BD55DE63FBA6319C2B0D3939437726AC61E320C804D0952DC24041`

## Intended use

Produce a first-pass category suggestion for a user's Inbox capture, among `task`, `event`, `request`, `habit`, `goal_subgoal`, `project`, `note_idea`, and `list`. It is a statistical classifier, not a conversational or generative language model. It does not plan, summarize, infer intent beyond these labels, or create any destination.

The statistical artifact is bundled with the first-party Supabase Edge Function. Classification uses the same SimpleLife-owned Supabase runtime already processing the capture; it does not call Google, OpenRouter, Cloudflare Workers AI, ARIA, Hugging Face inference, or another third-party inference API. No additional provider credentials, quotas, or paid inference are required. This is an application-data processing choice, not a claim that an internet-hosted Supabase DEV environment is physically on the user's device.

## Data and training

- 614 synthetic-only Spanish/English training examples; no owner captures, transcripts, personal records, or production data.
- Random seed: `20261128`.
- Features: separate word TF-IDF (1–2 grams) and character TF-IDF (3–5 grams), 256 features per branch; sublinear term frequency and L2 normalization.
- Estimator: multinomial logistic regression, balanced class weights, `C=2.0`, deterministic seed.
- The JSON contains the vocabulary, inverse document frequencies, coefficients, intercepts, category order, and review thresholds. It is a compact inference artifact; raw training phrases are not embedded.
- Training/test split on generated synthetic data: 90.24% accuracy on the 205-item holdout.
- A separate 80-phrase, hand-written synthetic Spanish/English phrase set: 77.50% accuracy. At the configured selective thresholds (top score at least 0.55 and top-to-second margin at least 0.12), 41 of 80 phrases were eligible; 92.68% of those 41 were correct.
- These are small synthetic offline evaluations, not real-user performance evidence. They do not support a guarantee of accuracy or generalization to accents, dialects, long multi-intent text, or real-world capture distributions.

## Inference and review policy

The model's softmax value is a ranking score, **not a calibrated probability**. A single unambiguous explicit category cue may override the statistical ranking; multiple competing cues always request clarification. Without an explicit cue, a result is offered without a clarification request only when both configured thresholds are met. Otherwise the UI asks the owner. All proposals remain `unreviewed` until the owner explicitly accepts, edits, rejects, or clarifies them.

Classification never writes an Event, Task, Habit, Goal, Project, Request, or other destination. Existing owner-scoped provenance, RLS, server-owned processing state, append-only audit, and idempotent queue completion remain authoritative.

## Privacy and operational boundary

The model is first-party and provider-free, but a Supabase DEV deployment is still cloud-hosted. Capture text is processed by SimpleLife's own Supabase Edge Function and stored in the user's existing owner-scoped Inbox tables. The model artifact and test fixtures contain no owner data. No data is sent to a separate model vendor. Production deployment is not implied by a successful Preview or CI run.

## Limitations and safety

- The classifier has no world knowledge, retrieval, reasoning dialogue, or explanation grounded in external facts.
- The explicit-cue layer is rule-based. Statistical suggestions are best-effort category rankings.
- The model can be wrong or uncertain; low-margin/overlapping inputs must remain reviewable.
- Requests and Habits may be proposed but remain non-confirmable until their destination workflows exist in their owning product phases.
- No transcript is silently overwritten, no original capture text is changed, and no destination is created automatically.
- Changing the artifact, vectorizer, class order, thresholds, or processor metadata requires retraining/verification, tests, and exact-HEAD CI.
- No external provider, third-party model endpoint, provider key, quota reservation, ARIA mission, LIVE budget policy, or paid inference is involved.

## Acceptance evidence

Local code tests and the production asset build are necessary but not sufficient. The Edge Runtime contract, dispatcher path, SQL owner isolation/idempotency, DEV Preview behavior, and exact-commit CI must pass before deploying this processor into DEV. The owner should review representative proposals and correct/reject them; uncalibrated scores must not be treated as probabilities.
