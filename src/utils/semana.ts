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
  return now.toISOString().slice(0, 10);
}

// Retorna meta semanal de polvora e capsula por cargo
export function getMetaSemanal(cargo: string): { polvora: number; capsula: number } {
  const metas: Record<string, { polvora: number; capsula: number }> = {
    iniciante:          { polvora: 500, capsula: 500 },
    membro:             { polvora: 1000, capsula: 1000 },
    gerente:            { polvora: 0,   capsula: 0 },
    "gerente de farm":  { polvora: 0,   capsula: 0 },
    "gerente de acao":  { polvora: 0,   capsula: 0 },
    sublider:           { polvora: 0,   capsula: 0 },
    lider:              { polvora: 0,   capsula: 0 },
  };
  return metas[cargo.toLowerCase()] ?? { polvora: 360, capsula: 360 };
}

export function temMeta(cargo: string): boolean {
  const meta = getMetaSemanal(cargo);
  return meta.polvora > 0;
}

export function getCargoLabel(cargo: string): string {
  const labels: Record<string, string> = {
    iniciante:          "Iniciante",
    membro:             "Membro",
    gerente:            "Gerente",
    "gerente de farm":  "Gerente de Farm",
    "gerente de acao":  "Gerente de Acao",
    sublider:           "Sublider",
    lider:              "Lider",
  };
  return labels[cargo.toLowerCase()] ?? cargo;
}

// Bônus de fim de semana baseado em faixas de pólvora entregue
export const BONUS_FDS_TIERS = [
  { minPolvora: 251, bonus: 80000, label: "251+ pólvora → +80k" },
  { minPolvora: 171, bonus: 40000, label: "171~250 pólvora → +40k" },
  { minPolvora: 80,  bonus: 15000, label: "80~170 pólvora → +15k" },
];

export function calcularBonusFds(polvora: number): number {
  for (const tier of BONUS_FDS_TIERS) {
    if (polvora >= tier.minPolvora) return tier.bonus;
  }
  return 0;
}

// Porcentagens de divisão
export const PERCENT_VENDEDOR = 0.40;
export const PERCENT_CAIXA_VENDA = 0.60;
export const PERCENT_FARMER = 0.25;
export const PERCENT_CAIXA_ACAO = 0.70;
export const PERCENT_PARTICIPANTES_ACAO = 0.30;

export const CARGOS_VALIDOS = [
  "iniciante",
  "membro",
  "gerente",
  "gerente de farm",
  "gerente de acao",
  "sublider",
  "lider",
];

export const CARGOS_GERENCIA  = ["gerente", "gerente de farm", "gerente de acao", "sublider", "lider"];
export const CARGOS_ADMIN     = ["sublider", "lider"];
export const CARGOS_ACAO      = ["gerente de acao", "sublider", "lider"];
export const CARGOS_RELATORIO = ["gerente de farm", "sublider", "lider"];

export function registrarAuditoria(acao: string, executadoPor: string, alvo?: string, detalhes?: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require("../database/db").default;
  db.prepare("INSERT INTO auditoria_log (acao, executado_por, alvo, detalhes) VALUES (?, ?, ?, ?)").run(acao, executadoPor, alvo ?? null, detalhes ?? null);
}
