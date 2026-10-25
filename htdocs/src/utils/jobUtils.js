// src/utils/jobUtils.js

// FlyFF Job IDs mapping
export const jobMapping = {
  0: "Vagrant",
  1: "Mercenary",
  2: "Acrobat",
  3: "Assist",
  4: "Magician",
  5: "Puppeter",
  6: "Knight",
  7: "Blade",
  8: "Jester",
  9: "Ranger",
  10: "Ringmaster",
  11: "Billposter",
  12: "Psykeeper",
  13: "Elementor",
  14: "Gatekeeper",
  15: "Doppler",
  16: "Knight (M)",
  17: "Blade (M)",
  18: "Jester (M)",
  19: "Ranger (M)",
  20: "Ringmaster (M)",
  21: "Billposter (M)",
  22: "Psykeeper (M)",
  23: "Elementor (M)",
  24: "Knight",
  25: "Blade",
  26: "Jester",
  27: "Ranger",
  28: "Ringmaster",
  29: "Billposter",
  30: "Psykeeper",
  31: "Elementor",
  32: "Templar",
  33: "Slayer",
  34: "Harlequin",
  35: "Crackshooter",
  36: "Seraph",
  37: "Forcemaster",
  38: "Mentalist",
  39: "Arcanist"
}

// Job image mapping using local resources
export const jobImages = {
  'Billposter': '/classes/billposter.png',
  'Blade': '/classes/blade.png',
  'Elementor': '/classes/elementor.png',
  'Jester': '/classes/jester.png',
  'Knight': '/classes/Knight.png',
  'Psykeeper': '/classes/psykeeper.png',
  'Ranger': '/classes/ranger.png',
  'Ringmaster': '/classes/ringmaster.png'
}

// Get job name from job ID
export const getJobName = (jobId) => {
  return jobMapping[jobId] || 'Unknown'
}

// Get job image path with fallback
export const getJobImage = (jobId) => {
  const jobName = jobMapping[jobId]
  // Strip off the "(M)" suffix for male variants to get base job name
  const baseJobName = jobName ? jobName.replace(' (M)', '') : ''
  // Default to Knight image if job image not found
  return jobImages[baseJobName] || jobImages['Knight']
}

// Get job color theme (can be used for styling)
export const getJobColor = (jobId) => {
  // Base colors for primary jobs
  const baseColors = {
    // 1st Job Colors
    'Mercenary': 'red-500',
    'Acrobat': 'green-500',
    'Assist': 'blue-400',
    'Magician': 'purple-500',
    'Puppeter': 'yellow-500',
    
    // Advanced Job Colors
    'Knight': 'red-600',
    'Blade': 'orange-500',
    'Jester': 'green-400',
    'Ranger': 'emerald-500',
    'Ringmaster': 'blue-500',
    'Billposter': 'yellow-600',
    'Psykeeper': 'purple-600',
    'Elementor': 'cyan-500',
    
    // Master Job Colors
    'Templar': 'red-700',
    'Slayer': 'orange-700',
    'Harlequin': 'green-700',
    'Crackshooter': 'emerald-700',
    'Seraph': 'blue-700',
    'Forcemaster': 'yellow-700',
    'Mentalist': 'purple-700',
    'Arcanist': 'cyan-700',
    
    // Default color for unknown jobs
    'default': 'gray-400'
  }

  const jobName = jobMapping[jobId]
  // Strip off the "(M)" suffix for male variants to get base job name
  const baseJobName = jobName ? jobName.replace(' (M)', '') : ''
  
  return baseColors[baseJobName] || baseColors.default
}