describe('start', () => {
	it('shows the app', async () => {
		await expect(browser).toHaveTitle(expect.stringContaining('Orders'))
	})
})
