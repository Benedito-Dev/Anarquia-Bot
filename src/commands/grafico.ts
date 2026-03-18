import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
} from "discord.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import db from "../database/db";
import { getSemanaAtual, CARGOS_GERENCIA } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("grafico")
  .setDescription("Graficos de produtividade da semana (gerencia)")
  .addStringOption((opt) =>
    opt
      .setName("tipo")
      .setDescription("Tipo de grafico")
      .setRequired(true)
      .addChoices(
        { name: "Farm (cobres por dia)", value: "farm" },
        { name: "Dinheiro Sujo (por dia)", value: "dinheiro" },
        { name: "Vendas (receita por dia)", value: "vendas" },
        { name: "Geral (tudo em um)", value: "geral" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const membro = db
    .prepare("SELECT cargo FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string } | undefined;

  if (!membro || !CARGOS_GERENCIA.includes(membro.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerencia ou superior** pode ver graficos.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const tipo = interaction.options.getString("tipo", true);
  const semanaAtual = getSemanaAtual();

  const width = 800;
  const height = 400;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  if (tipo === "farm") {
    await gerarGraficoFarm(interaction, chartJSNodeCanvas, semanaAtual);
  } else if (tipo === "dinheiro") {
    await gerarGraficoDinheiro(interaction, chartJSNodeCanvas, semanaAtual);
  } else if (tipo === "vendas") {
    await gerarGraficoVendas(interaction, chartJSNodeCanvas, semanaAtual);
  } else {
    await gerarGraficoGeral(interaction, chartJSNodeCanvas, semanaAtual);
  }
}

async function gerarGraficoFarm(interaction: ChatInputCommandInteraction, canvas: ChartJSNodeCanvas, semana: string) {
  const dados = db
    .prepare(`
      SELECT DATE(criado_em) as dia, COALESCE(SUM(cobres), 0) as total
      FROM farm_entregas
      WHERE semana = ?
      GROUP BY DATE(criado_em)
      ORDER BY dia
    `)
    .all(semana) as Array<{ dia: string; total: number }>;

  const labels = dados.map((d) => d.dia.split("-")[2] + "/" + d.dia.split("-")[1]);
  const values = dados.map((d) => d.total);

  const config = {
    type: "line" as const,
    data: {
      labels,
      datasets: [
        {
          label: "Cobres",
          data: values,
          borderColor: "rgb(46, 204, 113)",
          backgroundColor: "rgba(46, 204, 113, 0.2)",
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `Farm - ${semana}`,
          font: { size: 18 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  };

  const buffer = await canvas.renderToBuffer(config);
  const attachment = new AttachmentBuilder(buffer, { name: "farm.png" });
  await interaction.editReply({ files: [attachment] });
}

async function gerarGraficoDinheiro(interaction: ChatInputCommandInteraction, canvas: ChartJSNodeCanvas, semana: string) {
  const dados = db
    .prepare(`
      SELECT DATE(criado_em) as dia, COALESCE(SUM(valor), 0) as total
      FROM dinheiro_entregas
      WHERE semana = ?
      GROUP BY DATE(criado_em)
      ORDER BY dia
    `)
    .all(semana) as Array<{ dia: string; total: number }>;

  const labels = dados.map((d) => d.dia.split("-")[2] + "/" + d.dia.split("-")[1]);
  const values = dados.map((d) => d.total);

  const config = {
    type: "line" as const,
    data: {
      labels,
      datasets: [
        {
          label: "Dinheiro Sujo",
          data: values,
          borderColor: "rgb(52, 152, 219)",
          backgroundColor: "rgba(52, 152, 219, 0.2)",
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `Dinheiro Sujo - ${semana}`,
          font: { size: 18 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  };

  const buffer = await canvas.renderToBuffer(config);
  const attachment = new AttachmentBuilder(buffer, { name: "dinheiro.png" });
  await interaction.editReply({ files: [attachment] });
}

async function gerarGraficoVendas(interaction: ChatInputCommandInteraction, canvas: ChartJSNodeCanvas, semana: string) {
  const dados = db
    .prepare(`
      SELECT DATE(criado_em) as dia, COALESCE(SUM(receita_total), 0) as total
      FROM vendas
      WHERE criado_em >= date('now', 'weekday 0', '-6 days')
      GROUP BY DATE(criado_em)
      ORDER BY dia
    `)
    .all() as Array<{ dia: string; total: number }>;

  const labels = dados.map((d) => d.dia.split("-")[2] + "/" + d.dia.split("-")[1]);
  const values = dados.map((d) => d.total);

  const config = {
    type: "bar" as const,
    data: {
      labels,
      datasets: [
        {
          label: "Receita Total",
          data: values,
          backgroundColor: "rgba(241, 196, 15, 0.7)",
          borderColor: "rgb(241, 196, 15)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `Vendas - ${semana}`,
          font: { size: 18 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  };

  const buffer = await canvas.renderToBuffer(config);
  const attachment = new AttachmentBuilder(buffer, { name: "vendas.png" });
  await interaction.editReply({ files: [attachment] });
}

async function gerarGraficoGeral(interaction: ChatInputCommandInteraction, canvas: ChartJSNodeCanvas, semana: string) {
  const farm = db
    .prepare(`
      SELECT DATE(criado_em) as dia, COALESCE(SUM(cobres), 0) as total
      FROM farm_entregas
      WHERE semana = ?
      GROUP BY DATE(criado_em)
      ORDER BY dia
    `)
    .all(semana) as Array<{ dia: string; total: number }>;

  const dinheiro = db
    .prepare(`
      SELECT DATE(criado_em) as dia, COALESCE(SUM(valor), 0) as total
      FROM dinheiro_entregas
      WHERE semana = ?
      GROUP BY DATE(criado_em)
      ORDER BY dia
    `)
    .all(semana) as Array<{ dia: string; total: number }>;

  const vendas = db
    .prepare(`
      SELECT DATE(criado_em) as dia, COALESCE(SUM(receita_total), 0) as total
      FROM vendas
      WHERE criado_em >= date('now', 'weekday 0', '-6 days')
      GROUP BY DATE(criado_em)
      ORDER BY dia
    `)
    .all() as Array<{ dia: string; total: number }>;

  const todosDias = new Set([...farm.map((d) => d.dia), ...dinheiro.map((d) => d.dia), ...vendas.map((d) => d.dia)]);
  const labels = Array.from(todosDias)
    .sort()
    .map((d) => d.split("-")[2] + "/" + d.split("-")[1]);

  const farmMap = new Map(farm.map((d) => [d.dia, d.total]));
  const dinheiroMap = new Map(dinheiro.map((d) => [d.dia, d.total / 10]));
  const vendasMap = new Map(vendas.map((d) => [d.dia, d.total / 1000]));

  const diasOrdenados = Array.from(todosDias).sort();

  const config = {
    type: "line" as const,
    data: {
      labels,
      datasets: [
        {
          label: "Farm (cobres)",
          data: diasOrdenados.map((d) => farmMap.get(d) || 0),
          borderColor: "rgb(46, 204, 113)",
          backgroundColor: "rgba(46, 204, 113, 0.2)",
          tension: 0.3,
        },
        {
          label: "Dinheiro Sujo (÷10)",
          data: diasOrdenados.map((d) => dinheiroMap.get(d) || 0),
          borderColor: "rgb(52, 152, 219)",
          backgroundColor: "rgba(52, 152, 219, 0.2)",
          tension: 0.3,
        },
        {
          label: "Vendas (÷1000)",
          data: diasOrdenados.map((d) => vendasMap.get(d) || 0),
          borderColor: "rgb(241, 196, 15)",
          backgroundColor: "rgba(241, 196, 15, 0.2)",
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `Produtividade Geral - ${semana}`,
          font: { size: 18 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  };

  const buffer = await canvas.renderToBuffer(config);
  const attachment = new AttachmentBuilder(buffer, { name: "geral.png" });
  await interaction.editReply({ files: [attachment] });
}
