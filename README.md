# Nawat

_An interactive dictionary and learning companion._

A language learning app for Nawat — a critically endangered indigenous
language of El Salvador with roughly 100 remaining speakers.

## About

This project aims to make learning Nawat accessible through an interactive,
gamified experience — preserving the language for future generations.

**On the spelling.** "Nawat" is the orthography the revitalization movement in
El Salvador standardised on, and it is what this project uses everywhere it is
read — the language, the title, this repository. The domain and the
infrastructure keep the older and more widely recognised "Nahuat" —
`nahuat.com` and the AWS resource names — because the domain is registered and
live, and its recognisability is worth something to a project that wants to be
found by people searching the older form. The rule and the reasoning behind it
are in
[ADR 14](docs/adr/0014-nawat-for-the-language-nahuat-for-the-project.md).

## Tech Stack

| Layer          | Technology                          |
| -------------- | ----------------------------------- |
| Frontend       | Next.js 16, Tailwind CSS, shadcn/ui |
| Backend        | NestJS, TypeScript                  |
| Database       | PostgreSQL 16, Prisma               |
| Cache          | ElastiCache (Valkey)                |
| Infrastructure | AWS, Terraform                      |
| Auth           | Auth0                               |

## Development

Setup and the local gotchas worth knowing are in
[docs/local-development.md](docs/local-development.md).

Architecture decisions — what was chosen, what was rejected, and why — are in
[docs/adr/](docs/adr/README.md).

## Status

🚧 Under active development

## Licensing

**Application code** is licensed under the [MIT License](LICENSE).

**Language content** (dictionary entries, translations, audio recordings)
is licensed under [CC BY-NC 4.0](LICENSE-CONTENT). Freely available for
research, education, and community use. Commercial use requires permission.
