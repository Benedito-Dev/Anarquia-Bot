export function getSemanaAtual(): string {
  const now = new Date();
  const year = now.getFullYear();
  const firstDay = new Date(year, 0, 1);
  const days = Math.floor((now.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
  return `${year}-W${week.toString().padStart(2, "0")}`;
}

export function getDiaAtual(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function getMetaDiaria(cargo: string): number {
  const metas: Record<string, number> = {
    iniciante: 200,
    membro: 200,
    "farmer veterano": 200,
    gerente: 200,
    "gerente de farm": 0,
    "gerente de acao": 0,
    sublider: 0,
    lider: 0,
  };
  return metas[cargo.toLowerCase()] ?? 200;
}

/** @deprecated use getMetaDiaria */
export function getMetaSemanal(cargo: string): number {
  return getMetaDiaria(cargo);
}

export function getCargoLabel(cargo: string): string {
  const labels: Record<string, string> = {
    iniciante: "Iniciante",
    membro: "Membro",
    "farmer veterano": "Farmer Veterano",
    gerente: "Gerente",
    "gerente de farm": "Gerente de Farm",
    "gerente de acao": "Gerente de Acao",
    sublider: "Sublider",
    lider: "Lider",
  };
  return labels[cargo.toLowerCase()] ?? cargo;
}

export function getMetaDinheiroDiaria(): number {
  return 50000;
}

export const BONUS_DINHEIRO_TIERS = [
  { valor: 500000, bonus: 50000, label: "500k na semana → +50k" },
  { valor: 350000, bonus: 25000, label: "350k na semana → +25k" },
  { valor: 200000, bonus: 10000, label: "200k na semana → +10k" },
];

export const CARGOS_VALIDOS = [
  "iniciante",
  "membro",
  "farmer veterano",
  "gerente",
  "gerente de farm",
  "gerente de acao",
  "sublider",
  "lider",
];

export const CARGOS_GERENCIA = ["gerente", "gerente de farm", "gerente de acao", "sublider", "lider"];
export const CARGOS_ADMIN = ["sublider", "lider"];
export const CARGOS_MEMBRO_ADMIN = ["gerente", "gerente de farm", "gerente de acao", "sublider", "lider"];
export const CARGOS_ACAO = ["gerente de acao", "sublider", "lider"];
export const CARGOS_RELATORIO = ["gerente de farm", "sublider", "lider"];

export function registrarAuditoria(acao: string, executadoPor: string, alvo?: string, detalhes?: string): void {
  // importado dinamicamente para evitar dependencia circular
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require("../database/db").default;
  db.prepare("INSERT INTO auditoria_log (acao, executado_por, alvo, detalhes) VALUES (?, ?, ?, ?)").run(acao, executadoPor, alvo ?? null, detalhes ?? null);
}
