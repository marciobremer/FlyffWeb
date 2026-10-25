// Formats raw playtime from the database into a readable string
export function formatPlayTime(rawTime) {
  // Handle null, undefined, or zero cases
  if (!rawTime || rawTime === 0) return '0'

  // For FlyFF database, playtime is stored in minutes
  const totalMinutes = parseInt(rawTime)
  
  // Calculate hours
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  
  // Format the time parts
  let timeString = ''
  
  if (hours > 0) {
    timeString += `${hours}h `
  }
  
  if (minutes > 0 || timeString === '') {
    timeString += `${minutes}m`
  }
  
  return timeString.trim()
}
  