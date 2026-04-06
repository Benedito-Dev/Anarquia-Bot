import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_VALIDOS, CARGOS_ADMIN, getCargoLabel, getMetaSemanal, temMeta, getSemanaAtual, registrarAuditoria } from "../utils/semana";

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
            { name: "Gerente", value: "gerente" },
            { name: "Gerente de Farm", value: "gerente de farm" },
            { name: "Gerente de Acao", value: "gerente de acao" },
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
            { name: "Gerente", value: "gerente" },
            { name: "Gerente de Farm", value: "gerente de farm" },
            { name: "Gerente de Acao", value: "gerente de acao" },
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
      .setName("historico_semana")
      .setDescription("Ver historico da semana atual de um membro (gerencia+)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("historico_completo")
      .setDescription("Ver historico completo de todas as semanas de um membro (gerencia+)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("rebaixar")
      .setDescription("Rebaixar membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("cargo")
          .setDescription("Novo cargo (inferior ao atual)")
          .setRequired(true)
          .addChoices(
            { name: "Iniciante", value: "iniciante" },
            { name: "Membro", value: "membro" },
            { name: "Gerente", value: "gerente" },
            { name: "Gerente de Farm", value: "gerente de farm" },
            { name: "Gerente de Acao", value: "gerente de acao" },
            { name: "Sublider", value: "sublider" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("vip")
      .setDescription("Ativar ou desativar VIP de um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      )
      .addBooleanOption((opt) =>
        opt.setName("ativo").setDescription("true = ativar VIP | false = remover VIP").setRequired(true),
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
  } else if (subcommand === "historico_semana") {
    await historicoSemana(interaction);
  } else if (subcommand === "historico_completo") {
    await historicoCompleto(interaction);
  } else if (subcommand === "folga") {
    await folga(interaction);
  } else if (subcommand === "vip") {
    await vip(interaction);
  } else if (subcommand === "rebaixar") {
    await rebaixar(interaction);
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
      { name: "Meta semanal", value: temMeta(cargo) ? `${meta.polvora} polvora / ${meta.capsula} capsula` : "Sem meta", inline: true },
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
      { name: "Nova meta", value: temMeta(novoCargo) ? `${getMetaSemanal(novoCargo).polvora} polvora / ${getMetaSemanal(novoCargo).capsula} capsula` : "Sem meta", inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function listar(interaction: ChatInputCommandInteraction) {
  const membros = db
    .prepare("SELECT discord_id, nome, passaporte, cargo FROM membros WHERE ativo = 1 ORDER BY CASE cargo WHEN 'lider' THEN 1 WHEN 'sublider' THEN 2 WHEN 'gerente de acao' THEN 3 WHEN 'gerente de farm' THEN 4 WHEN 'gerente' THEN 5 WHEN 'membro' THEN 6 WHEN 'iniciante' THEN 7 END")
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
  const progresso = temMeta(membro.cargo) ? Math.min(100, Math.round((farmSemana.cobres / meta.polvora) * 100)) : 100;

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
      { name: "🌾 Farm", value: `${farmSemana.cobres} cobres | ${farmSemana.entregas} entregas\nMeta: ${temMeta(membro.cargo) ? `${progresso}% (${farmSemana.cobres}/${meta.polvora})` : "Sem meta"}`, inline: true },
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

async function rebaixar(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const novoCargo = interaction.options.getString("cargo", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ? AND ativo = 1")
    .get(usuario.id) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const ordem = ["iniciante", "membro", "gerente", "gerente de farm", "gerente de acao", "sublider", "lider"];
  const indexAtual = ordem.indexOf(membro.cargo.toLowerCase());
  const indexNovo = ordem.indexOf(novoCargo);

  if (indexNovo >= indexAtual) {
    await interaction.reply({ content: `O cargo **${novoCargo}** nao e inferior ao cargo atual (**${membro.cargo}**). Use /membro promover.`, ephemeral: true });
    return;
  }

  const cargoAnterior = membro.cargo;
  db.prepare("UPDATE membros SET cargo = ?, nome = ? WHERE discord_id = ?").run(novoCargo, usuario.displayName, usuario.id);
  registrarAuditoria("membro_rebaixado", interaction.user.id, usuario.id, `${usuario.displayName}: ${cargoAnterior} → ${novoCargo}`);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("Membro Rebaixado")
        .addFields(
          { name: "Nome", value: usuario.displayName, inline: true },
          { name: "Cargo anterior", value: getCargoLabel(cargoAnterior), inline: true },
          { name: "Novo cargo", value: getCargoLabel(novoCargo), inline: true },
        )
        .setFooter({ text: `Rebaixado por ${interaction.user.displayName}` })
        .setTimestamp(),
    ],
  });
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

async function vip(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const ativo = interaction.options.getBoolean("ativo", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ? AND ativo = 1")
    .get(usuario.id) as { id: number; nome: string; vip: number } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado ou esta inativo.`, ephemeral: true });
    return;
  }

  if ((membro.vip === 1) === ativo) {
    await interaction.reply({ content: `**${membro.nome}** ja ${ativo ? "possui" : "nao possui"} VIP.`, ephemeral: true });
    return;
  }

  db.prepare("UPDATE membros SET vip = ? WHERE id = ?").run(ativo ? 1 : 0, membro.id);
  registrarAuditoria(ativo ? "vip_ativado" : "vip_removido", interaction.user.id, usuario.id, membro.nome);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ativo ? 0xf1c40f : 0x95a5a6)
        .setTitle(ativo ? "⭐ VIP Ativado" : "VIP Removido")
        .addFields(
          { name: "Membro", value: membro.nome, inline: true },
          { name: "Status", value: ativo ? "⭐ VIP Ativo" : "Normal", inline: true },
          { name: "Meta diária", value: ativo ? "1.300 pólvora / 1.300 cápsula" : "650 pólvora / 650 cápsula", inline: false },
        )
        .setFooter({ text: `Por ${interaction.user.displayName}` })
        .setTimestamp(),
    ],
  });
}

async function historicoSemana(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const semana = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string; cargo: string; criado_em: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const farm = db
    .prepare("SELECT polvora, capsula, criado_em FROM farm_entregas WHERE membro_id = ? AND semana = ? ORDER BY id DESC")
    .all(membro.id, semana) as Array<{ polvora: number; capsula: number; criado_em: string }>;

  const pagamentos = db
    .prepare("SELECT COALESCE(SUM(fp.valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonus = db
    .prepare("SELECT valor, descricao, criado_em FROM bonus_log WHERE membro_id = ? AND semana = ? ORDER BY id DESC")
    .all(membro.id, semana) as Array<{ valor: number; descricao: string | null; criado_em: string }>;

  const vendas = db
    .prepare("SELECT tipo_municao, quantidade, valor_vendedor, criado_em FROM vendas WHERE vendedor_discord_id = ? AND criado_em >= date('now','weekday 0','-6 days') ORDER BY id DESC")
    .all(usuario.id) as Array<{ tipo_municao: string; quantidade: number; valor_vendedor: number; criado_em: string }>;

  const advertencias = db
    .prepare("SELECT motivo, dado_por, criado_em FROM advertencias WHERE membro_id = ? AND criado_em >= date('now','weekday 0','-6 days') ORDER BY id DESC")
    .all(membro.id) as Array<{ motivo: string; dado_por: string; criado_em: string }>;

  const folga = db
    .prepare("SELECT folga_dia FROM membros WHERE id = ?")
    .get(membro.id) as { folga_dia: string | null };

  const meta = getMetaSemanal(membro.cargo);
  const totalPolvora = farm.reduce((acc, f) => acc + f.polvora, 0);
  const totalCapsula = farm.reduce((acc, f) => acc + f.capsula, 0);
  const totalBonus = bonus.reduce((acc, b) => acc + b.valor, 0);
  const totalVendas = vendas.reduce((acc, v) => acc + v.valor_vendedor, 0);

  const farmTexto = farm.length > 0
    ? farm.map((f) => `🌾 ${f.polvora} polvora | ${f.capsula} capsula — ${f.criado_em.split(" ")[0]}`).join("\n")
    : "Nenhuma entrega.";

  const bonusTexto = bonus.length > 0
    ? bonus.map((b) => `🎉 $${b.valor.toLocaleString()} — ${b.descricao ?? ""} (${b.criado_em.split(" ")[0]})`).join("\n")
    : "Nenhum bonus.";

  const vendasTexto = vendas.length > 0
    ? vendas.map((v) => `🛒 ${v.quantidade}x ${v.tipo_municao.toUpperCase()} — $${v.valor_vendedor.toLocaleString()} (${v.criado_em.split(" ")[0]})`).join("\n")
    : "Nenhuma venda.";

  const advTexto = advertencias.length > 0
    ? advertencias.map((a) => `⚠️ ${a.motivo} — <@${a.dado_por}> (${a.criado_em.split(" ")[0]})`).join("\n")
    : "Nenhuma advertencia essa semana.";

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📋 Historico Semana — ${membro.nome} (${semana})`)
        .addFields(
          { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
          { name: "Folga", value: folga.folga_dia ?? "Nenhuma", inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: `🌾 Farm (${farm.length} entregas)`, value: farmTexto },
          { name: "📊 Totais farm", value: `${totalPolvora} polvora | ${totalCapsula} capsula\nMeta: ${temMeta(membro.cargo) ? `${totalPolvora}/${meta.polvora} polvora` : "Sem meta"}`, inline: true },
          { name: "💰 Pagamentos farm", value: `$${pagamentos.total.toLocaleString()}`, inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: `🛒 Vendas (${vendas.length})`, value: vendasTexto },
          { name: `🎉 Bonus (${bonus.length})`, value: bonusTexto },
          { name: "⚠️ Advertencias", value: advTexto },
          { name: "━━━ Total Ganhos ━━━", value: `$${(pagamentos.total + totalBonus + totalVendas).toLocaleString()}` },
        )
        .setTimestamp(),
    ],
  });
}

async function historicoCompleto(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string; cargo: string; criado_em: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const farmTotal = db
    .prepare("SELECT COALESCE(SUM(polvora), 0) as polvora, COALESCE(SUM(capsula), 0) as capsula, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ?")
    .get(membro.id) as { polvora: number; capsula: number; entregas: number };

  const pagamentosTotal = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos WHERE membro_id = ?")
    .get(membro.id) as { total: number };

  const bonusTotal = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd FROM bonus_log WHERE membro_id = ?")
    .get(membro.id) as { total: number; qtd: number };

  const vendasTotal = db
    .prepare("SELECT COUNT(*) as qtd, COALESCE(SUM(quantidade), 0) as municoes, COALESCE(SUM(valor_vendedor), 0) as ganhos FROM vendas WHERE vendedor_discord_id = ?")
    .get(usuario.id) as { qtd: number; municoes: number; ganhos: number };

  const advertencias = db
    .prepare("SELECT motivo, dado_por, criado_em, ativa FROM advertencias WHERE membro_id = ? ORDER BY id DESC LIMIT 10")
    .all(membro.id) as Array<{ motivo: string; dado_por: string; criado_em: string; ativa: number }>;

  const auditoria = db
    .prepare("SELECT acao, detalhes, criado_em FROM auditoria_log WHERE alvo = ? ORDER BY id DESC LIMIT 15")
    .all(usuario.id) as Array<{ acao: string; detalhes: string | null; criado_em: string }>;

  const divida = db
    .prepare("SELECT valor_devido FROM dividas WHERE membro_discord_id = ?")
    .get(usuario.id) as { valor_devido: number } | undefined;

  const advTexto = advertencias.length > 0
    ? advertencias.map((a) => `${a.ativa ? "⚠️" : "~~⚠️~~"} ${a.motivo} — <@${a.dado_por}> (${a.criado_em.split(" ")[0]})`).join("\n")
    : "Nenhuma advertencia.";

  const audTexto = auditoria.length > 0
    ? auditoria.map((a) => `\`${a.acao}\` ${a.detalhes ? `— ${a.detalhes}` : ""} (${a.criado_em.split(" ")[0]})`).join("\n")
    : "Nenhum registro administrativo.";

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`📚 Historico Completo — ${membro.nome}`)
        .addFields(
          { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
          { name: "Membro desde", value: membro.criado_em.split(" ")[0], inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: "🌾 Farm total", value: `${farmTotal.polvora} polvora | ${farmTotal.capsula} capsula\n${farmTotal.entregas} entregas`, inline: true },
          { name: "💰 Ganhos farm", value: `$${pagamentosTotal.total.toLocaleString()}`, inline: true },
          { name: "🎉 Bonus total", value: `$${bonusTotal.total.toLocaleString()} (${bonusTotal.qtd}x)`, inline: true },
          { name: "🛒 Vendas total", value: `${vendasTotal.municoes} municoes (${vendasTotal.qtd} vendas)`, inline: true },
          { name: "💰 Ganhos vendas", value: `$${vendasTotal.ganhos.toLocaleString()}`, inline: true },
          { name: "💳 Divida atual", value: `$${(divida?.valor_devido ?? 0).toLocaleString()}`, inline: true },
          { name: "⚠️ Advertencias (ultimas 10)", value: advTexto },
          { name: "📋 Log administrativo (ultimas 15)", value: audTexto },
        )
        .setTimestamp(),
    ],
  });
}
