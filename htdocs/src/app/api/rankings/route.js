import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'

// Helper function to format playtime from raw minutes
function formatPlayTime(rawTime) {
  if (!rawTime || rawTime === 0) return '0m'
  
  // Convert to minutes if needed (in case it's in a different unit)
  const minutes = Math.floor(rawTime)
  
  // Calculate hours and remaining minutes
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  
  // If less than an hour, just show minutes
  if (hours === 0) {
    return `${remainingMinutes}m`
  }
  
  // If less than a day, show hours and minutes
  if (hours < 24) {
    return `${hours}h ${remainingMinutes}m`
  }
  
  // Calculate days and remaining hours
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  
  return `${days}d ${remainingHours}h ${remainingMinutes}m`
}

export async function GET() {
  try {
    const db = await connectToDatabase()
    
    const result = await db.query`
      SELECT a.m_szname, a.m_nJob,a.TotalPlayTime,a.m_nLevel,ISNULL(c.m_szGuild,'None') as m_szGuild
        FROM [CHARACTER_01_DBF].[dbo].[CHARACTER_TBL] a
        LEFT OUTER JOIN  CHARACTER_01_DBF.dbo.[GUILD_MEMBER_TBL] b on b.m_idPlayer = a.m_idPlayer
        LEFT OUTER JOIN CHARACTER_01_DBF.dbo.GUILD_TBL c on c.m_idGuild  = b.m_idGuild ORDER BY a.TotalPlayTime DESC

    `

    // Format the data
    const players = result.recordset.map(player => ({
      ...player,
      TotalPlayTime: formatPlayTime(player.TotalPlayTime)
    }))

    return NextResponse.json({ success: true, players })
  } catch (error) {
    console.error('Database error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch rankings' }, 
      { status: 500 }
    )
  }
} 