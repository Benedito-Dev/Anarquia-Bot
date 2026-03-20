import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_VALIDOS, CARGOS_ADMIN, getCargoLabel, getMetaSemanal, getSemanaAtual, registrarAuditoria } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("membro")
  .setDescription("Comandos de membros (admin)")
  .addSubcommand((sub) =>
    sub
      .setName("cadastrar")
      .setDescription("Cadastrar membro na familia (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("passaporte")
          .setDescription("ID do membro no RP (passaporte)")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("cargo")
          .setDescription("Cargo do membro")
          .setRequired(true)
          .addChoices(
            { name: "Iniciante", value: "iniciante" },
            { name: "Membro", value: "membro" },
            { name: "Farmer Veterano", value: "farmer veterano" },
            { name: "Gerente", value: "gerente" },
            { name: "Sublider", value: "sublider" },
            { name: "Lider", value: "lider" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("promover")
      .setDescription("Promover membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("cargo")
          .setDescription("Novo cargo")
          .setRequired(true)
          .addChoices(
            { name: "Iniciante", value: "iniciante" },
            { name: "Membro", value: "membro" },
            { name: "Farmer Veterano", value: "farmer veterano" },
            { name: "Gerente", value: "gerente" },
            { name: "Sublider", value: "sublider" },
            { name: "Lider", value: "lider" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("listar").setDescription("Listar todos os membros"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remover")
      .setDescription("Remover membro da familia (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("passaporte")
      .setDescription("Definir passaporte (ID no RP) de um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("ID do passaporte no RP").setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("perfil")
      .setDescription("Ver historico completo de um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("historico")
      .setDescription("Ver advertencias, promocoes e acoes de um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("folga")
      .setDescription("Conceder ou remover folga de um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("data")
          .setDescription("Data da folga (YYYY-MM-DD). Deixe vazio para remover folga atual.")
          .setRequired(false),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand !== "listar") {
    const totalMembros = db.prepare("SELECT COUNT(*) as total FROM membros WHERE ativo = 1").get() as { total: number };
    const isFirstSetup = totalMembros.total === 0 && subcommand === "cadastrar";

    if (!isFirstSetup) {
      const admin = db
        .prepare("SELECT * FROM membros WHERE discord_id = ?")
        .get(interaction.user.id) as { cargo: string } | undefined;

      if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
        await interaction.reply({
          content: "Apenas **Sublider ou Lider** pode gerenciar membros.",
          ephemeral: true,
        });
        return;
      }
    }
  }

  if (subcommand === "cadastrar") {
    await cadastrar(interaction);
  } else if (subcommand === "promover") {
    await promover(interaction);
  } else if (subcommand === "listar") {
    await listar(interaction);
  } else if (subcommand === "remover") {
    await remover(interaction);
  } else if (subcommand === "passaporte") {
    await definirPassaporte(interaction);
  } else if (subcommand === "perfil") {
    await perfil(interaction);
  } else if (subcommand === "historico") {
    await historico(interaction);
  } else if (subcommand === "folga") {
    await folga(interaction);
  }
}

async function cadastrar(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const cargo = interaction.options.getString("cargo", true);
  const passaporte = interaction.options.getString("passaporte", true);

  if (!CARGOS_VALIDOS.includes(cargo)) {
    await interaction.reply({ content: `Cargo invalido. Validos: ${CARGOS_VALIDOS.join(", ")}`, ephemeral: true });
    return;
  }

  const existente = db.prepare("SELECT * FROM membros WHERE discord_id = ?").get(usuario.id) as { ativo: number } | undefined;
  if (existente) {
    if (existente.ativo === 1) {
      await interaction.reply({ content: `**${usuario.displayName}** ja esta cadastrado.`, ephemeral: true });
      return;
    }
    // Membro inativo — reativar
    const passaporteExistente = db.prepare("SELECT * FROM membros WHERE passaporte = ? AND discord_id != ?").get(passaporte, usuario.id);
    if (passaporteExistente) {
      await interaction.reply({ content: `Passaporte **${passaporte}** ja esta em uso.`, ephemeral: true });
      return;
    }
    db.prepare("UPDATE membros SET ativo = 1, nome = ?, passaporte = ?, cargo = ? WHERE discord_id = ?").run(
      usuario.displayName, passaporte, cargo, usuario.id,
    );
    registrarAuditoria("membro_reativado", interaction.user.id, usuario.id, `${usuario.displayName} — cargo: ${cargo} — passaporte: ${passaporte}`);
  } else {
    const passaporteExistente = db.prepare("SELECT * FROM membros WHERE passaporte = ?").get(passaporte);
    if (passaporteExistente) {
      await interaction.reply({ content: `Passaporte **${passaporte}** ja esta em uso.`, ephemeral: true });
      return;
    }
    db.prepare("INSERT INTO membros (discord_id, nome, passaporte, cargo) VALUES (?, ?, ?, ?)").run(
      usuario.id, usuario.displayName, passaporte, cargo,
    );
    registrarAuditoria("membro_cadastrado", interaction.user.id, usuario.id, `${usuario.displayName} — cargo: ${cargo} — passaporte: ${passaporte}`);
  }
  const meta = getMetaSemanal(cargo);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Membro Cadastrado!")
    .addFields(
      { name: "Nome", value: usuario.displayName, inline: true },
      { name: "Passaporte", value: passaporte, inline: true },
      { name: "Cargo", value: getCargoLabel(cargo), inline: true },
      { name: "Meta diaria", value: meta > 0 ? `${meta} cobres` : "Sem meta", inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function promover(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const novoCargo = interaction.options.getString("cargo", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const cargoAnterior = membro.cargo;
  db.prepare("UPDATE membros SET cargo = ?, nome = ? WHERE discord_id = ?").run(novoCargo, usuario.displayName, usuario.id);
  registrarAuditoria("membro_promovido", interaction.user.id, usuario.id, `${usuario.displayName}: ${cargoAnterior} → ${novoCargo}`);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Membro Promovido!")
    .addFields(
      { name: "Nome", value: usuario.displayName, inline: true },
      { name: "Cargo anterior", value: getCargoLabel(cargoAnterior), inline: true },
      { name: "Novo cargo", value: getCargoLabel(novoCargo), inline: true },
      { name: "Nova meta", value: getMetaSemanal(novoCargo) > 0 ? `${getMetaSemanal(novoCargo)} cobres/semana` : "Sem meta", inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function listar(interaction: ChatInputCommandInteraction) {
  const membros = db
    .prepare("SELECT discord_id, nome, passaporte, cargo FROM membros WHERE ativo = 1 ORDER BY CASE cargo WHEN 'lider' THEN 1 WHEN 'sublider' THEN 2 WHEN 'gerente' THEN 3 WHEN 'farmer veterano' THEN 4 WHEN 'membro' THEN 5 WHEN 'iniciante' THEN 6 END")
    .all() as Array<{ discord_id: string; nome: string; passaporte: string | null; cargo: string }>;

  if (membros.length === 0) {
    await interaction.reply({ content: "Nenhum membro cadastrado.", ephemeral: true });
    return;
  }

  let texto = "";
  let cargoAtual = "";

  for (const m of membros) {
    if (m.cargo !== cargoAtual) {
      cargoAtual = m.cargo;
      texto += `\n**— ${getCargoLabel(m.cargo)} —**\n`;
    }
    const passaporte = m.passaporte ? `[${m.passaporte}]` : "[sem passaporte]";
    texto += `<@${m.discord_id}> ${passaporte}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Membros da Familia (${membros.length})`)
    .setDescription(texto)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function remover(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  db.prepare("UPDATE membros SET ativo = 0 WHERE discord_id = ?").run(usuario.id);
  registrarAuditoria("membro_removido", interaction.user.id, usuario.id, membro.nome);

  // Tentar dar kick no Discord
  let kickStatus = "";
  try {
    const membroGuild = await interaction.guild?.members.fetch(usuario.id);
    if (membroGuild) {
      await membroGuild.kick("Removido da familia pelo sistema");
      kickStatus = "✅ Kick aplicado no Discord";
    }
  } catch {
    kickStatus = "⚠️ Nao foi possivel dar kick (verifique as permissoes do bot)";
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("Membro Removido")
        .setDescription(`**${membro.nome}** foi removido da familia.\n${kickStatus}`)
        .setTimestamp(),
    ],
  });
}

async function definirPassaporte(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const id = interaction.options.getInteger("id", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const duplicado = db.prepare("SELECT * FROM membros WHERE passaporte = ? AND discord_id != ?").get(id, usuario.id);
  if (duplicado) {
    await interaction.reply({ content: `Passaporte **${id}** ja esta em uso por outro membro.`, ephemeral: true });
    return;
  }

  db.prepare("UPDATE membros SET passaporte = ? WHERE discord_id = ?").run(id, usuario.id);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("Passaporte Atualizado")
        .addFields(
          { name: "Membro", value: membro.nome, inline: true },
          { name: "Passaporte", value: `${id}`, inline: true },
        )
        .setTimestamp(),
    ],
  });
}

async function perfil(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const semana = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string; cargo: string; passaporte: string | null; criado_em: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  // Farm da semana
  const farmSemana = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as cobres, COALESCE(SUM(aluminios), 0) as aluminios, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { cobres: number; aluminios: number; entregas: number };

  const meta = getMetaSemanal(membro.cargo);
  const progresso = meta > 0 ? Math.min(100, Math.round((farmSemana.cobres / meta) * 100)) : 100;

  // Ganhos farm da semana
  const ganhosFarm = db
    .prepare("SELECT COALESCE(SUM(fp.valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  // Vendas da semana
  const vendasSemana = db
    .prepare("SELECT COALESCE(SUM(valor_vendedor), 0) as ganhos, COALESCE(SUM(quantidade_produtos), 0) as produtos, COUNT(*) as qtd FROM vendas WHERE vendedor_discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(usuario.id) as { ganhos: number; produtos: number; qtd: number };

  // Bonus da semana
  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd FROM bonus_log WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number; qtd: number };

  // Acoes da semana
  const acoesSemana = db
    .prepare("SELECT COUNT(*) as qtd, COALESCE(SUM(valor_recebido), 0) as total FROM acao_participantes WHERE discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(usuario.id) as { qtd: number; total: number };

  // Total geral da semana
  const totalSemana = ganhosFarm.total + vendasSemana.ganhos + bonusSemana.total + acoesSemana.total;

  const farmTotal = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as cobres, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ?")
    .get(membro.id) as { cobres: number; entregas: number };

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Perfil — ${membro.nome}`)
    .addFields(
      { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
      { name: "Passaporte", value: membro.passaporte ?? "Nao definido", inline: true },
      { name: "Membro desde", value: membro.criado_em.split(" ")[0], inline: true },
      { name: "━━━ Semana Atual ━━━", value: "\u200b" },
      { name: "🌾 Farm", value: `${farmSemana.cobres} cobres | ${farmSemana.entregas} entregas\nMeta: ${meta > 0 ? `${progresso}% (${farmSemana.cobres}/${meta})` : "Sem meta"}`, inline: true },
      { name: "🛒 Vendas", value: `${vendasSemana.produtos} produtos (${vendasSemana.qtd} vendas)`, inline: true },
      { name: "⚔️ Acoes", value: `${acoesSemana.qtd} acoes | $${acoesSemana.total.toLocaleString()}`, inline: true },
      { name: "💰 Ganhos farm", value: `$${ganhosFarm.total.toLocaleString()}`, inline: true },
      { name: "💰 Ganhos vendas", value: `$${vendasSemana.ganhos.toLocaleString()}`, inline: true },
      { name: "🎉 Bonus", value: `$${bonusSemana.total.toLocaleString()} (${bonusSemana.qtd}x)`, inline: true },
      { name: "📊 Total da semana", value: `**$${totalSemana.toLocaleString()}**`, inline: true },
      { name: "━━━ Historico Geral ━━━", value: "\u200b" },
      { name: "Total farmado", value: `${farmTotal.cobres} cobres | ${farmTotal.entregas} entregas`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export function membroTemFolga(membroId: number, dia: string): boolean {
  const membro = db
    .prepare("SELECT folga_dia FROM membros WHERE id = ?")
    .get(membroId) as { folga_dia: string | null } | undefined;
  return membro?.folga_dia === dia;
}

async function folga(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const dataOpt = interaction.options.getString("data");

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ? AND ativo = 1")
    .get(usuario.id) as { id: number; nome: string; folga_dia: string | null } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado ou esta inativo.`, ephemeral: true });
    return;
  }

  // Sem data = remover folga
  if (!dataOpt) {
    if (!membro.folga_dia) {
      await interaction.reply({ content: `**${membro.nome}** nao possui folga agendada.`, ephemeral: true });
      return;
    }
    db.prepare("UPDATE membros SET folga_dia = NULL WHERE id = ?").run(membro.id);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle("Folga Removida")
          .setDescription(`A folga de **${membro.nome}** foi removida.`)
          .setTimestamp(),
      ],
    });
    return;
  }

  // Validar formato da data
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataOpt)) {
    await interaction.reply({ content: "Formato de data invalido. Use **YYYY-MM-DD** (ex: 2025-07-20).", ephemeral: true });
    return;
  }

  db.prepare("UPDATE membros SET folga_dia = ? WHERE id = ?").run(dataOpt, membro.id);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🏖️ Folga Concedida")
    .addFields(
      { name: "Membro", value: membro.nome, inline: true },
      { name: "Data da folga", value: dataOpt, inline: true },
    )
    .setDescription("As metas desse dia serao desaplicadas automaticamente.")
    .setFooter({ text: `Concedida por ${interaction.user.displayName}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function historico(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string; cargo: string; criado_em: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const advertencias = db
    .prepare("SELECT motivo, dado_por, criado_em, ativa FROM advertencias WHERE membro_id = ? ORDER BY id DESC LIMIT 10")
    .all(membro.id) as Array<{ motivo: string; dado_por: string; criado_em: string; ativa: number }>;

  const auditoria = db
    .prepare("SELECT acao, detalhes, criado_em FROM auditoria_log WHERE alvo = ? ORDER BY id DESC LIMIT 10")
    .all(usuario.id) as Array<{ acao: string; detalhes: string | null; criado_em: string }>;

  const acoes = db
    .prepare("SELECT COUNT(*) as qtd, COALESCE(SUM(valor_recebido), 0) as total FROM acao_participantes WHERE discord_id = ?")
    .get(usuario.id) as { qtd: number; total: number };

  const farmTotal = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as cobres, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ?")
    .get(membro.id) as { cobres: number; entregas: number };

  const vendasTotal = db
    .prepare("SELECT COUNT(*) as qtd, COALESCE(SUM(quantidade_produtos), 0) as produtos FROM vendas WHERE vendedor_discord_id = ?")
    .get(usuario.id) as { qtd: number; produtos: number };

  const advTexto = advertencias.length > 0
    ? advertencias.map((a) => `${a.ativa ? "⚠️" : "~~⚠️~~"} ${a.motivo} — <@${a.dado_por}> (${a.criado_em})`).join("\n")
    : "Nenhuma advertencia.";

  const audTexto = auditoria.length > 0
    ? auditoria.map((a) => `\`${a.acao}\` — ${a.detalhes ?? ""} (${a.criado_em})`).join("\n")
    : "Nenhuma acao administrativa.";

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Historico — ${membro.nome}`)
    .addFields(
      { name: "Cargo atual", value: getCargoLabel(membro.cargo), inline: true },
      { name: "Membro desde", value: membro.criado_em.split(" ")[0], inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "🌾 Farm total", value: `${farmTotal.cobres} cobres | ${farmTotal.entregas} entregas`, inline: true },
      { name: "🛒 Vendas total", value: `${vendasTotal.produtos} produtos (${vendasTotal.qtd} vendas)`, inline: true },
      { name: "⚔️ Acoes total", value: `${acoes.qtd} acoes | $${acoes.total.toLocaleString()}`, inline: true },
      { name: "⚠️ Advertencias (ultimas 10)", value: advTexto },
      { name: "📋 Log administrativo (ultimas 10)", value: audTexto },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
