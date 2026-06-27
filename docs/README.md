# SignBuddy AI — Documentation Index

| Document | Covers |
|---|---|
| [PRD.md](./PRD.md) | Problem, goals, functional/non-functional requirements, known v1 limitations |
| [user-personas.md](./user-personas.md) | The five people this product is designed for |
| [system-architecture.md](./system-architecture.md) | Full request lifecycle, data flow, failure modes |
| [ai-architecture.md](./ai-architecture.md) | The ML pipeline — what's real vs. mocked, model interface contract |
| [api-documentation.md](./api-documentation.md) | Every backend route, request/response shapes, generated against actual route code |
| [frontend-design-system.md](./frontend-design-system.md) | Color, type, components, accessibility implementation |
| [deployment-architecture.md](./deployment-architecture.md) | Containers, Kubernetes topology, CI/CD, secrets |
| [testing-strategy.md](./testing-strategy.md) | What's actually tested today vs. honest gaps |
| [security-plan.md](./security-plan.md) | Data classification, auth, known gaps |
| [scalability-plan.md](./scalability-plan.md) | Where the real bottleneck will be, how each tier scales |

Database schema: [`../database/migrations/001_init_schema.sql`](../database/migrations/001_init_schema.sql)
AI model training plan: [`../ai-service/training/README.md`](../ai-service/training/README.md)

**Reading order for a new engineer joining the project:** PRD → user-personas → system-architecture → ai-architecture → api-documentation, then the relevant deep-dive (frontend-design-system, deployment, testing, security, or scalability) depending on which part of the stack you're working on.
