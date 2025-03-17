const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Setup enhanced logging for EC2 environment
const log = (message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  log(`Unhandled rejection: ${error.message}`);
  console.error(error);
});

// Create a new client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

// Configuration - you can customize these
const config = {
  supportRoleId: process.env.SUPPORT_ROLE_ID || '', // Role ID for support staff
  ticketCategory: process.env.TICKET_CATEGORY_ID || '',    // Category ID where tickets will be created
  ticketsLogChannel: process.env.TICKETS_LOG_CHANNEL_ID || '', // Channel ID for ticket logs
  prefix: process.env.PREFIX || '!', // Command prefix
};

// Store active tickets - in production you'd use a database
const activeTickets = new Map();

// Load or create ticket counter
let ticketCounter = 1;
const counterFile = path.join(__dirname, 'ticketCounter.json');

if (fs.existsSync(counterFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(counterFile));
    ticketCounter = data.counter || 1;
  } catch (err) {
    console.error('Error loading ticket counter:', err);
  }
}

// Save counter function
function saveCounter() {
  fs.writeFileSync(counterFile, JSON.stringify({ counter: ticketCounter }));
}

client.once('ready', () => {
  log(`Bot is online! Logged in as ${client.user.tag}`);
  log(`Bot is serving ${client.guilds.cache.size} servers`);
});

// Handle commands
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Parse command
  if (message.content.startsWith(config.prefix)) {
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Setup ticket system command
    if (command === 'setup-tickets' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder()
        .setTitle('🎫 Support Tickets')
        .setDescription('Need help? Click the button below to create a support ticket.')
        .setColor('#3498db');
      
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel('Create Ticket')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎫')
        );
      
      await message.channel.send({ embeds: [embed], components: [row] });
      await message.delete().catch(err => console.error('Could not delete message:', err));
    }
    
    // Close ticket command
    if (command === 'close') {
      // Check if the channel is a ticket
      if (!activeTickets.has(message.channel.id)) {
        return message.reply('This command can only be used in ticket channels.');
      }
      
      await closeTicket(message.channel, message.author);
    }
  }
});

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  // Handle ticket creation button
  if (interaction.customId === 'create_ticket') {
    await interaction.deferReply({ ephemeral: true });
    
    // Check if user already has an open ticket
    const existingTicket = Array.from(activeTickets.values()).find(
      ticket => ticket.userId === interaction.user.id
    );
    
    if (existingTicket) {
      const ticketChannel = interaction.guild.channels.cache.get(existingTicket.channelId);
      if (ticketChannel) {
        return interaction.editReply({
          content: `You already have an open ticket at ${ticketChannel}`,
          ephemeral: true
        });
      }
    }
    
    // Create new ticket
    try {
      const ticketChannel = await createTicket(interaction);
      interaction.editReply({
        content: `Your ticket has been created: ${ticketChannel}`,
        ephemeral: true
      });
    } catch (error) {
      log(`Error creating ticket: ${error.message}`);
      console.error('Error creating ticket:', error);
      interaction.editReply({
        content: 'There was an error creating your ticket. Please try again later.',
        ephemeral: true
      });
    }
  }
  
  // Handle ticket closing button
  if (interaction.customId === 'close_ticket') {
    // Check if user has permission to close
    const ticketData = activeTickets.get(interaction.channel.id);
    if (!ticketData) return;
    
    const isSupportRole = interaction.member.roles.cache.has(config.supportRoleId);
    const isTicketCreator = interaction.user.id === ticketData.userId;
    
    if (!isSupportRole && !isTicketCreator) {
      return interaction.reply({
        content: 'You do not have permission to close this ticket.',
        ephemeral: true
      });
    }
    
    await closeTicket(interaction.channel, interaction.user);
  }
});

// Function to create a ticket
async function createTicket(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;
  
  // Create channel name
  const ticketId = ticketCounter++;
  const channelName = `ticket-${ticketId.toString().padStart(4, '0')}`;
  
  // Save counter
  saveCounter();
  
  // Create the ticket channel
  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.ticketCategory,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: config.supportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  // Store ticket data
  activeTickets.set(ticketChannel.id, {
    id: ticketId,
    userId: user.id,
    username: user.tag,
    channelId: ticketChannel.id,
    createdAt: new Date(),
  });

  // Create ticket welcome message
  const embed = new EmbedBuilder()
    .setTitle(`Ticket #${ticketId.toString().padStart(4, '0')}`)
    .setDescription(`Hello, ${user}! Please describe your issue and a staff member will assist you shortly.`)
    .setColor('#3498db')
    .setFooter({ text: `Ticket created by ${user.tag}` })
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );

  await ticketChannel.send({ embeds: [embed], components: [row] });
  
  // Mention support role
  await ticketChannel.send(`<@&${config.supportRoleId}> A new ticket has been created.`);
  
  // Log ticket creation
  logTicketAction(guild, user, ticketId, 'created');
  
  return ticketChannel;
}

// Function to close a ticket
async function closeTicket(channel, closer) {
  // Get ticket data
  const ticketData = activeTickets.get(channel.id);
  if (!ticketData) return;
  
  // Create transcript (basic implementation)
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const transcript = Array.from(messages.values())
      .reverse()
      .map(m => `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author.tag}: ${m.content}`)
      .join('\n');
    
    const transcriptFile = path.join(__dirname, 'transcripts', `ticket-${ticketData.id}.txt`);
    
    // Create transcripts directory if it doesn't exist
    if (!fs.existsSync(path.join(__dirname, 'transcripts'))) {
      fs.mkdirSync(path.join(__dirname, 'transcripts'));
    }
    
    fs.writeFileSync(transcriptFile, transcript);
    
    // Log ticket closing
    logTicketAction(channel.guild, closer, ticketData.id, 'closed');
    
    // Send closing message
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('Ticket Closing')
          .setDescription('This ticket will be closed in 5 seconds.')
          .setColor('#e74c3c')
          .setFooter({ text: `Closed by ${closer.tag}` })
          .setTimestamp()
      ]
    });
    
    // Remove from active tickets
    activeTickets.delete(channel.id);
    
    // Delete channel after delay
    setTimeout(() => {
      channel.delete().catch(err => console.error('Error deleting channel:', err));
    }, 5000);
    
  } catch (error) {
    console.error('Error closing ticket:', error);
    channel.send('There was an error closing this ticket. Please try again.');
  }
}

// Function to log ticket actions
function logTicketAction(guild, user, ticketId, action) {
  const logChannel = guild.channels.cache.get(config.ticketsLogChannel);
  if (!logChannel) return;
  
  const embed = new EmbedBuilder()
    .setTitle(`Ticket ${action}`)
    .setDescription(`Ticket #${ticketId.toString().padStart(4, '0')} was ${action} by ${user.tag}`)
    .setColor(action === 'created' ? '#2ecc71' : '#e74c3c')
    .setTimestamp();
  
  logChannel.send({ embeds: [embed] });
}

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
