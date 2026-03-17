"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARGOS_ADMIN = exports.CARGOS_GERENCIA = exports.CARGOS_VALIDOS = void 0;
exports.getSemanaAtual = getSemanaAtual;
exports.getMetaSemanal = getMetaSemanal;
exports.getCargoLabel = getCargoLabel;
function getSemanaAtual() {
    const now = new Date();
    const year = now.getFullYear();
    const firstDay = new Date(year, 0, 1);
    const days = Math.floor((now.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000));
    const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
    return `${year}-W${week.toString().padStart(2, "0")}`;
}
function getMetaSemanal(cargo) {
    const metas = {
        iniciante: 150,
        membro: 300,
        "farmer veterano": 600,
        gerente: 0,
        sublider: 0,
        lider: 0,
    };
    return metas[cargo.toLowerCase()] ?? 150;
}
function getCargoLabel(cargo) {
    const labels = {
        iniciante: "Iniciante",
        membro: "Membro",
        "farmer veterano": "Farmer Veterano",
        gerente: "Gerente",
        sublider: "Sublider",
        lider: "Lider",
    };
    return labels[cargo.toLowerCase()] ?? cargo;
}
exports.CARGOS_VALIDOS = [
    "iniciante",
    "membro",
    "farmer veterano",
    "gerente",
    "sublider",
    "lider",
];
exports.CARGOS_GERENCIA = ["gerente", "sublider", "lider"];
exports.CARGOS_ADMIN = ["sublider", "lider"];
