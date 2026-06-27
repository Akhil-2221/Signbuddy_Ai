# Training a Real Sign Recognition Model

This is the honest plan for replacing `MockSignClassifier` with a real model. It cannot be executed inside this chat — it needs GPU compute, labeled datasets, and weeks of iteration — but here is the concrete path.

## 1. Data

| Language | Source | Notes |
|---|---|---|
| ASL | WLASL (2000 classes, ~21k videos) | Most mature public dataset |
| ASL | RWTH-PHOENIX-Weather | Continuous sentence-level, German actually — useful for architecture validation, not ASL vocab |
| ISL | ISL-CSLRT, INCLUDE dataset (Indian Institute of Science) | Much smaller than ASL — expect to need active data collection |
| BSL | BSL Corpus (UCL), BOBSL | Research-access datasets, may need institutional agreement |

For production accuracy beyond a demo vocabulary, plan on **commissioning additional labeled data** from native signers — public datasets alone are not enough for high-stakes use cases (hospitals, emergencies).

## 2. Preprocessing

Use `pipeline/landmark_extractor.py` (already real) to convert every training video to landmark sequences rather than training on raw pixels — this is both more data-efficient and matches what production inference will receive.

## 3. Model architecture

Two reasonable starting points, per the research cited in the Executive Summary:

- **CNN + LSTM**: spatial CNN per-frame on landmark-derived features, temporal LSTM over the sequence. Simpler, proven (~98% accuracy reported on constrained ASL vocab in research).
- **Transformer encoder**: better for longer continuous signing / full sentences, more data-hungry.

Start with CNN+LSTM on isolated signs (the MVP vocabulary — greetings, emergency phrases), then graduate to continuous/transformer-based recognition once isolated accuracy is solid.

## 4. Training infrastructure

- PyTorch (already in `requirements.txt`)
- GPU instance (AWS EC2 `g5.xlarge` or similar) — not available in this chat sandbox
- Track experiments with Weights & Biases or MLflow
- Hold out a test set stratified by **signer identity**, not just by clip, so the model is evaluated on generalization to unseen signers, not memorized style

## 5. Evaluation targets

- Top-1 accuracy >90% on held-out isolated vocabulary before considering production use
- Sign Error Rate (SER) / Word Error Rate (WER) for continuous signing
- Fairness check: accuracy broken out by skin tone, hand size, age, and signing speed — sign recognition models have documented bias against signers underrepresented in training data

## 6. Plugging into this codebase

Implement `SignClassifier` from `pipeline/interfaces.py`:

```python
class TrainedSignClassifier(SignClassifier):
    def __init__(self, checkpoint_path: str):
        self.model = torch.load(checkpoint_path)
        self.model.eval()

    def classify_sequence(self, frames, sign_language):
        # real inference here
        ...
```

Then in `app/main.py`, change:
```python
classifier = MockSignClassifier()
```
to:
```python
classifier = TrainedSignClassifier(checkpoint_path="models/asl_v1.pt")
```

No other file needs to change — that's the whole point of the interface boundary.
