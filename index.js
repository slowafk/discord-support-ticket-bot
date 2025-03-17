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

// Configuration - using environment variables
const config = {
  supportRoleId: process.env.SUPPORT_ROLE_ID || '', // Role ID for support staff
  ticketCategory: process.env.TICKET_CATEGORY_ID || '',    // Category ID where tickets will be created
  ticketsLogChannel: process.env.TICKETS_LOG_CHANNEL_ID || '', // Channel ID for ticket logs
  prefix: process.env.PREFIX || '!', // Command prefix
};

// Log configuration values for debugging
log('Bot Configuration:');
log(`Support Role ID: ${config.supportRoleId}`);
log(`Ticket Category ID: ${config.ticketCategory}`);
log(`Tickets Log Channel ID: ${config.ticketsLogChannel}`);
log(`Prefix: ${config.prefix}`);

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
      log(`Setting up ticket system in channel ${message.channel.name}`);
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
      
      try {
        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete().catch(err => log(`Could not delete setup message: ${err.message}`));
        log('Successfully set up ticket system');
      } catch (error) {
        log(`Error setting up ticket system: ${error.message}`);
        message.reply('An error occurred while setting up the ticket system. Please check the bot permissions.').catch(err => log(`Could not send error reply: ${err.message}`));
      }
    }
    
    // Close ticket command
    if (command === 'close') {
      // Check if the channel is a ticket
      if (!activeTickets.has(message.channel.id)) {
        return message.reply('This command can only be used in ticket channels.').catch(err => log(`Could not send reply: ${err.message}`));
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
    await interaction.deferReply({ ephemeral: true }).catch(err => log(`Could not defer reply: ${err.message}`));
    
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
        }).catch(err => log(`Could not edit reply: ${err.message}`));
      }
    }
    
    // Create new ticket
    try {
      const ticketChannel = await createTicket(interaction);
      if (ticketChannel) {
        interaction.editReply({
          content: `Your ticket has been created: ${ticketChannel}`,
          ephemeral: true
        }).catch(err => log(`Could not edit reply: ${err.message}`));
      } else {
        interaction.editReply({
          content: 'There was an error creating your ticket. Please try again later.',
          ephemeral: true
        }).catch(err => log(`Could not edit reply: ${err.message}`));
      }
    } catch (error) {
      log(`Error in ticket creation process: ${error.message}`);
      console.error('Error creating ticket:', error);
      interaction.editReply({
        content: 'There was an error creating your ticket. Please try again later.',
        ephemeral: true
      }).catch(err => log(`Could not edit reply: ${err.message}`));
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
      }).catch(err => log(`Could not send reply: ${err.message}`));
    }
    
    await closeTicket(interaction.channel, interaction.user);
  }
});

// SIMPLIFIED: Function to create a ticket
async function createTicket(interaction) {
  try {
    const guild = interaction.guild;
    const user = interaction.user;
    
    // Create channel name
    const ticketId = ticketCounter++;
    const channelName = `ticket-${ticketId.toString().padStart(4, '0')}`;
    
    // Save counter
    saveCounter();
    
    log(`Creating ticket #${ticketId} for user ${user.tag}`);
    
    // Create channel with minimal options, directly in the target category
    const channelOptions = {
      name: channelName,
      type: ChannelType.GuildText
    };
    
    // Only try to set the parent if the category exists
    const category = guild.channels.cache.get(config.ticketCategory);
    if (category) {
      log(`Found category: ${category.name}, trying to create channel directly in it`);
      channelOptions.parent = category.id;
    } else {
      log(`WARNING: Category with ID ${config.ticketCategory} not found!`);
    }

    // Create the channel with basic settings first
    log(`Creating channel ${channelName}`);
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create(channelOptions);
      log(`Channel created: ${ticketChannel.name} (${ticketChannel.id})`);
    } catch (err) {
      log(`ERROR creating channel: ${err.message}`);
      return null;
    }

    // Now set up permissions for the channel
    try {
      log(`Setting up base permissions`);
      await ticketChannel.permissionOverwrites.create(guild.id, {
        ViewChannel: false,
      });
      log(`Set base permissions for @everyone`);
      
      // Add user permission
      await ticketChannel.permissionOverwrites.create(user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
      log(`Set permissions for ticket creator`);
      
      // Add support role permission if it exists
      if (config.supportRoleId && guild.roles.cache.has(config.supportRoleId)) {
        await ticketChannel.permissionOverwrites.create(config.supportRoleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
        log(`Set permissions for support role`);
      } else {
        log(`WARNING: Support role ID ${config.supportRoleId} not found or invalid!`);
      }
    } catch (err) {
      log(`ERROR setting channel permissions: ${err.message}`);
      // Continue even if permissions failed, at least we have a channel
    }

    // Store ticket data
    activeTickets.set(ticketChannel.id, {
      id: ticketId,
      userId: user.id,
      username: user.tag,
      channelId: ticketChannel.id,
      createdAt: new Date(),
    });

    // Try to send welcome message
    try {
      log(`Creating welcome message in ticket channel`);
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
      log(`Sent welcome message`);
      
      // Try to mention support role
      if (config.supportRoleId && guild.roles.cache.has(config.supportRoleId)) {
        await ticketChannel.send(`<@&${config.supportRoleId}> A new ticket has been created.`);
        log(`Mentioned support role`);
      } else {
        await ticketChannel.send(`A new ticket has been created.`);
      }
    } catch (err) {
      log(`ERROR sending welcome message: ${err.message}`);
      // Try a simpler message
      try {
        await ticketChannel.send(`Ticket created for ${user.tag}. Please describe your issue.`);
      } catch (innerErr) {
        log(`ERROR sending simple message: ${innerErr.message}`);
        // Continue without welcome message
      }
    }
    
    // Try to log ticket creation
    try {
      logTicketAction(guild, user, ticketId, 'created');
    } catch (err) {
      log(`ERROR logging ticket creation: ${err.message}`);
      // Continue even if logging failed
    }
    
    log(`Ticket creation process completed`);
    return ticketChannel;
  } catch (error) {
    log(`CRITICAL ERROR in createTicket: ${error.message}`);
    console.error('Detailed error:', error);
    return null;
  }
}

// Function to close a ticket
async function closeTicket(channel, closer) {
  try {
    log(`Closing ticket in channel ${channel.name}`);
    
    // Get ticket data
    const ticketData = activeTickets.get(channel.id);
    if (!ticketData) {
      log(`No ticket data found for channel ${channel.id}`);
      return;
    }
    
    log(`Found ticket data: ID #${ticketData.id}, created by ${ticketData.username}`);
    
    // Create transcript (basic implementation)
    try {
      log(`Fetching messages for transcript`);
      const messages = await channel.messages.fetch({ limit: 100 }).catch(err => {
        log(`ERROR fetching messages: ${err.message}`);
        return null;
      });
      
      if (messages) {
        log(`Fetched ${messages.size} messages for transcript`);
        
        const transcript = Array.from(messages.values())
          .reverse()
          .map(m => `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author.tag}: ${m.content}`)
          .join('\n');
        
        const transcriptFile = path.join(__dirname, 'transcripts', `ticket-${ticketData.id}.txt`);
        
        // Create transcripts directory if it doesn't exist
        if (!fs.existsSync(path.join(__dirname, 'transcripts'))) {
          log(`Creating transcripts directory`);
          fs.mkdirSync(path.join(__dirname, 'transcripts'));
        }
        
        log(`Saving transcript to ${transcriptFile}`);
        fs.writeFileSync(transcriptFile, transcript);
        log(`Transcript saved successfully`);
      }
    } catch (err) {
      log(`ERROR creating transcript: ${err.message}`);
      // Continue even if transcript creation failed
    }
    
    // Try to log ticket closing
    try {
      logTicketAction(channel.guild, closer, ticketData.id, 'closed');
    } catch (err) {
      log(`ERROR logging ticket closure: ${err.message}`);
      // Continue even if logging failed
    }
    
    // Send closing message
    try {
      log(`Sending closing message`);
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
    } catch (err) {
      log(`ERROR sending closing message: ${err.message}`);
      // Continue even if sending message failed
    }
    
    // Remove from active tickets
    log(`Removing ticket from active tickets map`);
    activeTickets.delete(channel.id);
    
    // Delete channel after delay
    log(`Scheduling channel deletion in 5 seconds`);
    setTimeout(() => {
      log(`Deleting channel ${channel.name}`);
      channel.delete().catch(err => {
        log(`Error deleting channel: ${err.message}`);
        console.error('Error deleting channel:', err);
      });
    }, 5000);
    
  } catch (error) {
    log(`CRITICAL ERROR in closeTicket: ${error.message}`);
    console.error('Critical error in closeTicket:', error);
  }
}

// Function to log ticket actions
function logTicketAction(guild, user, ticketId, action) {
  try {
    log(`Attempting to log ticket ${action} action to channel`);
    
    const logChannel = guild.channels.cache.get(config.ticketsLogChannel);
    if (!logChannel) {
      log(`WARNING: Log channel ID ${config.ticketsLogChannel} not found or invalid!`);
      return;
    }
    
    log(`Found log channel: ${logChannel.name}`);
    
    const embed = new EmbedBuilder()
      .setTitle(`Ticket ${action}`)
      .setDescription(`Ticket #${ticketId.toString().padStart(4, '0')} was ${action} by ${user.tag}`)
      .setColor(action === 'created' ? '#2ecc71' : '#e74c3c')
      .setTimestamp();
    
    logChannel.send({ embeds: [embed] }).then(() => {
      log(`Successfully logged ticket ${action} action`);
    }).catch(error => {
      log(`Error sending log message: ${error.message}`);
      console.error('Error sending log message:', error);
    });
  } catch (error) {
    log(`ERROR in logTicketAction: ${error.message}`);
    console.error('Error in logTicketAction:', error);
  }
}

// Login to Discord
log(`Attempting to login with token`);
client.login(process.env.DISCORD_TOKEN).then(() => {
  log(`Login successful`);
}).catch(error => {
  log(`ERROR logging in: ${error.message}`);
  console.error('Login error:', error);
});
