import { ReactNode } from 'react'

interface AlertProps {
  children: ReactNode
  variant?: 'success' | 'error' | 'info'
  className?: string
}

export function Alert({ children, variant = 'info', className = '' }: AlertProps) {
  const baseClasses = 'p-4 rounded-md text-sm'
  const variantClasses = {
    success: 'bg-green-50 text-green-800 border border-green-200',
    error: 'bg-red-50 text-red-800 border border-red-200',
    info: 'bg-blue-50 text-blue-800 border border-blue-200'
  }

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  )
}