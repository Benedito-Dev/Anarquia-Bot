import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ADMIN, getCargoLabel } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("advertencia")
  .setDescription("Sistema de advertencias (admin)")
  .addSubcommand((sub) =>
    sub
      .setName("dar")
      .setDescription("Dar advertencia a um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("motivo").setDescription("Motivo da advertencia").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remover")
      .setDescription("Remover ultima advertencia de um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ver")
      .setDescription("Ver advertencias de um membro")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode gerenciar advertencias.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "dar") {
    await dar(interaction, admin.nome);
  } else if (subcommand === "remover") {
    await remover(interaction, admin.nome);
  } else if (subcommand === "ver") {
    await ver(interaction);
  }
}

async function dar(interaction: ChatInputCommandInteraction, adminNome: string) {
  const usuario = interaction.options.getUser("usuario", true);
  const motivo = interaction.options.getString("motivo", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ? AND ativo = 1")
    .get(usuario.id) as { id: number; nome: string; cargo: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado na familia.`, ephemeral: true });
    return;
  }

  db.prepare("INSERT INTO advertencias (membro_id, motivo, dado_por) VALUES (?, ?, ?)").run(
    membro.id, motivo, interaction.user.id,
  );

  const total = (db.prepare("SELECT COUNT(*) as total FROM advertencias WHERE membro_id = ? AND ativa = 1").get(membro.id) as { total: number }).total;

  // Notificar por DM
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("⚠️ Voce recebeu uma advertencia")
      .addFields(
        { name: "Motivo", value: motivo },
        { name: "Dado por", value: adminNome, inline: true },
        { name: "Advertencias ativas", value: `${total}/3`, inline: true },
      )
      .setTimestamp();
    await usuario.send({ embeds: [dmEmbed] });
  } catch {
    // DM bloqueada, ignora
  }

  // 3ª advertencia — pedir confirmacao
  if (total >= 3) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`expulsar_${membro.id}_${usuario.id}`)
        .setLabel("Confirmar Expulsao")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cancelar_expulsao`)
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Secondary),
    );

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("🚨 3ª Advertencia — Confirmacao Necessaria")
      .setDescription(`**${membro.nome}** atingiu 3 advertencias.\nDeseja expulsa-lo da familia?`)
      .addFields({ name: "Ultima advertencia", value: motivo })
      .setTimestamp();

    const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    const collector = reply.createMessageComponentCollector({ time: 60000 });

    collector.on("collect", async (btn) => {
      if (btn.user.id !== interaction.user.id) {
        await btn.reply({ content: "Apenas quem executou o comando pode confirmar.", ephemeral: true });
        return;
      }

      if (btn.customId.startsWith("expulsar_")) {
        db.prepare("UPDATE membros SET ativo = 0 WHERE id = ?").run(membro.id);
        try {
          await usuario.send({ content: "Voce foi expulso da familia por atingir 3 advertencias." });
        } catch { /* DM bloqueada */ }
        await btn.update({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Membro Expulso")
              .setDescription(`**${membro.nome}** foi expulso da familia.`)
              .setTimestamp(),
          ],
          components: [],
        });
      } else {
        await btn.update({
          embeds: [
            new EmbedBuilder()
              .setColor(0x95a5a6)
              .setTitle("Expulsao Cancelada")
              .setDescription(`**${membro.nome}** permanece na familia.`)
              .setTimestamp(),
          ],
          components: [],
        });
      }
      collector.stop();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction.editReply({ components: [] });
      }
    });

    return;
  }

  const cores = [0xf1c40f, 0xe67e22, 0xe74c3c];
  const embed = new EmbedBuilder()
    .setColor(cores[total - 1] ?? 0xe74c3c)
    .setTitle(`⚠️ Advertencia ${total}/3 — ${membro.nome}`)
    .addFields(
      { name: "Motivo", value: motivo },
      { name: "Advertencias ativas", value: `${total}/3`, inline: true },
      { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
    )
    .setFooter({ text: `Dado por ${adminNome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function remover(interaction: ChatInputCommandInteraction, adminNome: string) {
  const usuario = interaction.options.getUser("usuario", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const ultima = db
    .prepare("SELECT id FROM advertencias WHERE membro_id = ? AND ativa = 1 ORDER BY id DESC LIMIT 1")
    .get(membro.id) as { id: number } | undefined;

  if (!ultima) {
    await interaction.reply({ content: `**${membro.nome}** nao possui advertencias ativas.`, ephemeral: true });
    return;
  }

  db.prepare("UPDATE advertencias SET ativa = 0 WHERE id = ?").run(ultima.id);

  const restantes = (db.prepare("SELECT COUNT(*) as total FROM advertencias WHERE membro_id = ? AND ativa = 1").get(membro.id) as { total: number }).total;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Advertencia Removida")
    .addFields(
      { name: "Membro", value: membro.nome, inline: true },
      { name: "Advertencias restantes", value: `${restantes}/3`, inline: true },
    )
    .setFooter({ text: `Removido por ${adminNome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function ver(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string; cargo: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const advertencias = db
    .prepare("SELECT motivo, dado_por, criado_em FROM advertencias WHERE membro_id = ? AND ativa = 1 ORDER BY id ASC")
    .all(membro.id) as Array<{ motivo: string; dado_por: string; criado_em: string }>;

  if (advertencias.length === 0) {
    await interaction.reply({ content: `**${membro.nome}** nao possui advertencias ativas.`, ephemeral: true });
    return;
  }

  let texto = "";
  for (let i = 0; i < advertencias.length; i++) {
    texto += `**${i + 1}.** ${advertencias[i].motivo} — <@${advertencias[i].dado_por}> (${advertencias[i].criado_em})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(advertencias.length >= 3 ? 0xe74c3c : advertencias.length === 2 ? 0xe67e22 : 0xf1c40f)
    .setTitle(`Advertencias — ${membro.nome} (${advertencias.length}/3)`)
    .setDescription(texto)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
