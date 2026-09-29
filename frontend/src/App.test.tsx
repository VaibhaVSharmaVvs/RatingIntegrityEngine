import { render, screen } from '@testing-library/react'
import App from './App'

it('renders the app title', () => {
  render(<App />)
  expect(screen.getByText('Rating Integrity Engine')).toBeTruthy()
})
