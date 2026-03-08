# Zsh history settings - persist and share across terminals
# Sourced/included by snapshot scripts during sandbox provisioning
HISTFILE=~/.zsh_history
HISTSIZE=50000
SAVEHIST=50000
setopt INC_APPEND_HISTORY    # Write history after each command
setopt SHARE_HISTORY         # Share history between terminals
setopt HIST_IGNORE_DUPS      # Ignore duplicate commands
setopt HIST_VERIFY           # Show command before executing from history
setopt HIST_REDUCE_BLANKS    # Remove extra blanks from commands
