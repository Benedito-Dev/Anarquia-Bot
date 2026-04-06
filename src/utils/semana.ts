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

// Meta diaria base (sem VIP, sem Dominas)
export const META_DIARIA_BASE = { polvora: 650, capsula: 650 };

// Retorna meta diaria considerando VIP e se hoje tem Dominas
export function getMetaDiaria(vip: boolean, dominasHoje: boolean): { polvora: number; capsula: number } {
  let mult = 1;
  if (vip) mult *= 2;
  if (dominasHoje) mult *= 2;
  return {
    polvora: META_DIARIA_BASE.polvora * mult,
    capsula: META_DIARIA_BASE.capsula * mult,
  };
}

// Retorna meta semanal base (6 dias) + dias de Dominas na semana
export function getMetaSemanal(cargo: string, vip = false, diasDominasSemana = 0): { polvora: number; capsula: number } {
  if (!temMetaCargo(cargo)) return { polvora: 0, capsula: 0 };
  const multVip = vip ? 2 : 1;
  const baseDiaria = META_DIARIA_BASE.polvora * multVip;
  // 6 dias normais + dias de dominas rendem o dobro (ja contam como 2x no dia)
  const totalPolvora = baseDiaria * 6 + baseDiaria * diasDominasSemana;
  return { polvora: totalPolvora, capsula: totalPolvora };
}

export function temMetaCargo(cargo: string): boolean {
  const semMeta = ["gerente", "gerente de farm", "gerente de acao", "sublider", "lider"];
  return !semMeta.includes(cargo.toLowerCase());
}

// Manter compatibilidade com codigo existente
export function temMeta(cargo: string): boolean {
  return temMetaCargo(cargo);
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
