import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ADMIN, getSemanaAtual } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("caixa")
  .setDescription("Caixa da familia")
  .addSubcommand((sub) =>
    sub.setName("ver").setDescription("Ver saldo e movimentacoes do caixa"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("sacar")
      .setDescription("Retirar do caixa (admin)")
      .addIntegerOption((opt) =>
        opt
          .setName("valor")
          .setDescription("Valor a retirar")
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((opt) =>
        opt
          .setName("motivo")
          .setDescription("Motivo da retirada")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("depositar")
      .setDescription("Depositar no caixa (admin)")
      .addIntegerOption((opt) =>
        opt
          .setName("valor")
          .setDescription("Valor a depositar")
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((opt) =>
        opt
          .setName("motivo")
          .setDescription("Motivo do deposito")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("pagar_lideranca").setDescription("Pagar 300k para cada lider/sublider ativo (admin)"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "ver") {
    await ver(interaction);
  } else if (subcommand === "sacar") {
    await sacar(interaction);
  } else if (subcommand === "depositar") {
    await depositar(interaction);
  } else if (subcommand === "pagar_lideranca") {
    await pagarLideranca(interaction);
  }
}

async function ver(interaction: ChatInputCommandInteraction) {
  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  const totalVendas = db
    .prepare("SELECT COALESCE(SUM(valor_familia), 0) as total, COUNT(*) as qtd FROM vendas")
    .get() as { total: number; qtd: number };

  const totalSaques = db
    .prepare("SELECT COALESCE(SUM(ABS(valor)), 0) as total FROM caixa_log WHERE tipo = 'saque'")
    .get() as { total: number };

  const totalDepositos = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM caixa_log WHERE tipo = 'deposito'")
    .get() as { total: number };

  const logs = db
    .prepare("SELECT tipo, valor, descricao, criado_em FROM caixa_log ORDER BY id DESC LIMIT 5")
    .all() as Array<{ tipo: string; valor: number; descricao: string | null; criado_em: string }>;

  let movimentacoes = "";
  if (logs.length > 0) {
    for (const log of logs) {
      const emoji = log.tipo === "venda" ? "📈" : log.tipo === "saque" ? "📤" : "📥";
      const sinal = log.valor > 0 ? "+" : "";
      movimentacoes += `${emoji} ${sinal}$${log.valor.toLocaleString()} — ${log.descricao ?? log.tipo} (${log.criado_em})\n`;
    }
  } else {
    movimentacoes = "Nenhuma movimentacao ainda.";
  }

  const embed = new EmbedBuilder()
    .setColor(caixa.saldo > 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle("Caixa da Familia")
    .addFields(
      { name: "💰 Saldo atual", value: `**$${caixa.saldo.toLocaleString()}**`, inline: true },
      { name: "📈 Total vendas", value: `$${totalVendas.total.toLocaleString()} (${totalVendas.qtd} vendas)`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "📥 Depositos", value: `$${totalDepositos.total.toLocaleString()}`, inline: true },
      { name: "📤 Saques", value: `$${totalSaques.total.toLocaleString()}`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Ultimas movimentacoes", value: movimentacoes },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function sacar(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode sacar do caixa.", ephemeral: true });
    return;
  }

  const valor = interaction.options.getInteger("valor", true);
  const motivo = interaction.options.getString("motivo", true);

  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  if (caixa.saldo < valor) {
    await interaction.reply({
      content: `Saldo insuficiente. Caixa tem $${caixa.saldo.toLocaleString()}, tentou sacar $${valor.toLocaleString()}.`,
      ephemeral: true,
    });
    return;
  }

  db.transaction(() => {
    db.prepare("UPDATE caixa SET saldo = saldo - ?").run(valor);
    db.prepare(
      "INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)",
    ).run("saque", -valor, motivo, interaction.user.id);
  })();

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("Saque Realizado")
    .addFields(
      { name: "Valor", value: `$${valor.toLocaleString()}`, inline: true },
      { name: "Motivo", value: motivo, inline: true },
      { name: "Novo saldo", value: `$${(caixa.saldo - valor).toLocaleString()}`, inline: true },
    )
    .setFooter({ text: `Por ${admin.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function depositar(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode depositar no caixa.", ephemeral: true });
    return;
  }

  const valor = interaction.options.getInteger("valor", true);
  const motivo = interaction.options.getString("motivo", true);

  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  db.transaction(() => {
    db.prepare("UPDATE caixa SET saldo = saldo + ?").run(valor);
    db.prepare(
      "INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)",
    ).run("deposito", valor, motivo, interaction.user.id);
  })();

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Deposito Realizado")
    .addFields(
      { name: "Valor", value: `$${valor.toLocaleString()}`, inline: true },
      { name: "Motivo", value: motivo, inline: true },
      { name: "Novo saldo", value: `$${(caixa.saldo + valor).toLocaleString()}`, inline: true },
    )
    .setFooter({ text: `Por ${admin.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function pagarLideranca(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode executar este comando.", ephemeral: true });
    return;
  }

  const lideranca = db
    .prepare("SELECT discord_id, nome, cargo FROM membros WHERE ativo = 1 AND (cargo = 'lider' OR cargo = 'sublider')")
    .all() as Array<{ discord_id: string; nome: string; cargo: string }>;

  if (lideranca.length === 0) {
    await interaction.reply({ content: "Nenhum lider ou sublider ativo encontrado.", ephemeral: true });
    return;
  }

  const valorPorMembro = 300000;
  const totalNecessario = lideranca.length * valorPorMembro;
  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  // Protecao contra duplo pagamento na mesma semana
  const semana = getSemanaAtual();
  const jaFoiPago = db
    .prepare("SELECT COUNT(*) as total FROM caixa_log WHERE tipo = 'pagamento_lideranca' AND descricao LIKE ? ")
    .get(`%${semana}%`) as { total: number };

  if (jaFoiPago.total > 0) {
    await interaction.reply({
      content: `A lideranca ja foi paga essa semana (${semana}). Use \`/caixa ver\` para conferir.`,
      ephemeral: true,
    });
    return;
  }

  if (caixa.saldo < totalNecessario) {
    await interaction.reply({
      content: `Saldo insuficiente. Caixa tem $${caixa.saldo.toLocaleString()}, necessario $${totalNecessario.toLocaleString()}.`,
      ephemeral: true,
    });
    return;
  }

  db.transaction(() => {
    for (const membro of lideranca) {
      db.prepare("UPDATE caixa SET saldo = saldo - ?").run(valorPorMembro);
      db.prepare(
        "INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)",
      ).run("pagamento_lideranca", -valorPorMembro, `Pagamento semanal ${semana} — ${membro.nome} (${membro.cargo})`, membro.discord_id);
    }
  })();

  let lista = "";
  for (const m of lideranca) {
    lista += `<@${m.discord_id}> (${m.cargo}) — $${valorPorMembro.toLocaleString()}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Pagamento da Lideranca Realizado")
    .addFields(
      { name: "Membros pagos", value: lista },
      { name: "Total descontado", value: `$${totalNecessario.toLocaleString()}`, inline: true },
      { name: "Novo saldo", value: `$${(caixa.saldo - totalNecessario).toLocaleString()}`, inline: true },
    )
    .setFooter({ text: `Executado por ${admin.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
