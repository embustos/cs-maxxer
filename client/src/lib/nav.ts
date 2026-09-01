import {
  LayoutDashboard, CheckSquare, Briefcase, Calendar,
  Target, Users, MessageSquareText,
} from 'lucide-react'

// Every section the app has, declared once. Both the sidebar and the page heading read
// from this, so a section can't appear in the nav under one name and title itself
// another. Lives in lib/ rather than beside the component because a file that exports
// both a component and a constant breaks fast refresh.
export const LINKS = [
  { to: '/', label: 'Today', Icon: LayoutDashboard, end: true },
  { to: '/habits', label: 'Habits', Icon: CheckSquare },
  { to: '/applications', label: 'Applications', Icon: Briefcase },
  { to: '/events', label: 'Events', Icon: Calendar },
  { to: '/goals', label: 'Goals', Icon: Target },
  { to: '/connections', label: 'Connections', Icon: Users },
  { to: '/interviews', label: 'Interview prep', Icon: MessageSquareText },
]
